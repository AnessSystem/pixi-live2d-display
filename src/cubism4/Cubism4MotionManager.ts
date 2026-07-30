import { config } from "@/config";
import type { MotionManagerOptions } from "@/cubism-common/MotionManager";
import { MotionManager } from "@/cubism-common/MotionManager";
import { Cubism4ExpressionManager } from "@/cubism4/Cubism4ExpressionManager";
import type { Cubism4ModelSettings } from "@/cubism4/Cubism4ModelSettings";
import type { CubismSpec } from "@cubism/CubismSpec";
import type { CubismModel } from "@cubism/model/cubismmodel";
import type { ACubismMotion } from "@cubism/motion/acubismmotion";
import { CubismMotion } from "@cubism/motion/cubismmotion";
import { CubismMotionJson } from "@cubism/motion/cubismmotionjson";
import { CubismMotionQueueManager } from "@cubism/motion/cubismmotionqueuemanager";
import type { Mutable } from "../types/helpers";

export class Cubism4MotionManager extends MotionManager<CubismMotion, CubismSpec.Motion> {
    protected parallelMotions = true;

    readonly definitions: Partial<Record<string, CubismSpec.Motion[]>>;

    readonly groups = { idle: "Idle" } as const;

    readonly motionDataType = "json";

    readonly queueManager = new CubismMotionQueueManager();

    protected readonly queueManagers = [this.queueManager];

    declare readonly settings: Cubism4ModelSettings;

    expressionManager?: Cubism4ExpressionManager;

    eyeBlinkIds: string[];
    lipSyncIds: string[];

    constructor(settings: Cubism4ModelSettings, options?: MotionManagerOptions) {
        super(settings, options);

        this.definitions = settings.motions ?? {};
        this.eyeBlinkIds = settings.getEyeBlinkParameters() || [];
        this.lipSyncIds = settings.getLipSyncParameters() || [];

        this.init(options);
    }

    protected init(options?: MotionManagerOptions) {
        super.init(options);

        if (this.settings.expressions) {
            this.expressionManager = new Cubism4ExpressionManager(this.settings, options);
        }

        this.setupQueueManager(this.queueManager);
    }

    protected setupQueueManager(manager: CubismMotionQueueManager) {
        manager.setEventCallback((caller, eventValue, customData) => {
            this.emit("motion:" + eventValue);
        });

        return manager;
    }

    isFinished(): boolean {
        return this.queueManagers.every((manager) => manager.isFinished());
    }

    protected _startMotion(
        motion: CubismMotion,
        onFinish?: (motion: CubismMotion) => void,
    ): number {
        motion.setFinishedMotionHandler(onFinish as (motion: ACubismMotion) => void);

        const curves = motion._motionData.curves;
        const managers = this.queueManagers.filter((manager) =>
            manager._motions.some((entry) =>
                (entry._motion as CubismMotion)._motionData.curves.some((a) =>
                    curves.some((b) => a.type === b.type && a.id === b.id),
                ),
            ),
        );

        managers.forEach((manager) => manager.stopAllMotions());

        const manager =
            managers[0] ??
            this.queueManagers.find((manager) => manager.isFinished()) ??
            this.setupQueueManager(new CubismMotionQueueManager());

        if (!this.queueManagers.includes(manager)) {
            this.queueManagers.push(manager);
        }

        return manager.startMotion(motion, false, performance.now());
    }

    protected _stopAllMotions(): void {
        this.queueManagers.forEach((manager) => manager.stopAllMotions());
    }

    createMotion(data: object, group: string, definition: CubismSpec.Motion): CubismMotion {
        const motion = CubismMotion.create(data as unknown as CubismSpec.MotionJSON);
        const json = new CubismMotionJson(data as unknown as CubismSpec.MotionJSON);

        const defaultFadingDuration =
            (group === this.groups.idle
                ? config.idleMotionFadingDuration
                : config.motionFadingDuration) / 1000;

        // fading duration priorities: model.json > motion.json > config (default)

        // overwrite the fading duration only when it's not defined in the motion JSON
        if (json.getMotionFadeInTime() === undefined) {
            motion.setFadeInTime(
                definition.FadeInTime! > 0 ? definition.FadeInTime! : defaultFadingDuration,
            );
        }

        if (json.getMotionFadeOutTime() === undefined) {
            motion.setFadeOutTime(
                definition.FadeOutTime! > 0 ? definition.FadeOutTime! : defaultFadingDuration,
            );
        }

        motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);

        return motion;
    }

    getMotionFile(definition: CubismSpec.Motion): string {
        return definition.File;
    }

    protected getMotionName(definition: CubismSpec.Motion): string {
        return definition.File;
    }

    protected getSoundFile(definition: CubismSpec.Motion): string | undefined {
        return definition.Sound;
    }

    protected updateParameters(model: CubismModel, now: DOMHighResTimeStamp): boolean {
        const updated = this.queueManagers.map((manager) => manager.doUpdateMotion(model, now)).some(Boolean);

        for (const [group, motions] of Object.entries(this.motionGroups)) {
            if (!this.queueManagers.some((manager) => manager._motions.some((entry) => motions?.includes(entry._motion as CubismMotion)))) {
                this.getState(group).complete();
            }
        }

        return updated;
    }

    destroy() {
        super.destroy();

        this.queueManagers.forEach((manager) => manager.release());
        (this as Partial<Mutable<this>>).queueManager = undefined;
    }
}
