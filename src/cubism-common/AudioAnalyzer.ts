//母音データの定義
export type Vowel = "a" | "i" | "u" | "e" | "o";

//音声解析結果の定義
export interface AudioAnalysis {
    volume: number; //検出した音量
    vowel?: Vowel; //推定した母音
    mouthOpen: number; //Live2Dモデルの口の開き具合
    mouthForm: number; //Live2Dモデルの口の形
}

//母音ごとの特徴を保存
interface VowelProfile {
    f1: number; //第1フォルマント周波数
    f2: number; //第2フォルマント周波数
    open: number; //その母音に対応する口の開き
    form: number; //その母音に対応する口の形
}

//各母音の、口の開き具合、口の形の基準値を定義
const vowelProfiles: Record<Vowel, VowelProfile> = {
    a: { f1: 850, f2: 1400, open: 1, form: 0 },
    i: { f1: 300, f2: 2700, open: 0.25, form: 1 },
    u: { f1: 350, f2: 1500, open: 0.35, form: -1 },
    e: { f1: 500, f2: 2300, open: 0.5, form: 0.7 },
    o: { f1: 500, f2: 1000, open: 0.75, form: -0.7 },
};

//音量と母音から音声解析処理を行う
export class AudioAnalyzer {
    private context?: AudioContext; //Web Audio API全体を管理
    private source?: MediaElementAudioSourceNode; //音声をWeb Audio APIへ取り込むノード
    private analyser?: AnalyserNode; //波形データや周波数データを取得する解析ノード
    private samples?: Uint8Array; //時間内の波形データを格納する配列
    private spectrum?: Uint8Array; //周波数ごとの強度を格納する配列

    //平滑化された音量、口の開き、口の形、フォルマント周波数
    private volume = 0;
    private mouthOpen = 0;
    private mouthForm = 0;
    private f1 = 0;
    private f2 = 0;

    start(audio: HTMLMediaElement): void {
        this.stop();

        //Web Audio APIコンテキスト作成
        const context = new AudioContext();
        const source = context.createMediaElementSource(audio);
        const analyser = context.createAnalyser();

        //音声解析数値と接続設定
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        analyser.connect(context.destination);

        //作成した各オブジェクトをクラス内に保持
        this.context = context;
        this.source = source;
        this.analyser = analyser;

        //波形データと周波数データの保存用配列を作成
        this.samples = new Uint8Array(analyser.fftSize);
        this.spectrum = new Uint8Array(analyser.frequencyBinCount);

        //前回の解析値を初期化
        this.volume = 0;
        this.mouthOpen = 0;
        this.mouthForm = 0;
        this.f1 = 0;
        this.f2 = 0;

        if (context.state === "suspended") {
            void context.resume().catch(() => undefined);
        }
    }

    //音声の解析処理
    update(): AudioAnalysis | undefined {
        if (!this.context || !this.analyser || !this.samples || !this.spectrum) {
            return undefined;
        }

        //現在の音声波形と周波数スペクトルを書き込む
        this.analyser.getByteTimeDomainData(this.samples);
        this.analyser.getByteFrequencyData(this.spectrum);

        let sum = 0;

        //波形値の正規化と二乗の計算（二乗するのは、波形が正方向でも負方向でも音量として加算するため）
        for (const sample of this.samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
        }

        //RMS（二乗平均平方根）を計算。RMSを口パク用の0～1へ変換
        const rms = Math.sqrt(sum / this.samples.length);
        const target = Math.max(0, Math.min(1, (rms - 0.01) * 8));

        //急な口の動きの変化を防ぐために、現在値を目標音量へ数値分だけ近づける
        this.volume += (target - this.volume) * 0.35;

        let vowel: Vowel | undefined;

        //一定の音量がある場合のみ母音解析を行う
        if (rms > 0.015) {
            //周波数スペクトルの1要素が何Hzに相当するか計算
            const binWidth = this.context.sampleRate / this.analyser.fftSize;

            //Hz値範囲内のF1/F2候補を探す
            const nextF1 = this.findPeak(250, 1000, binWidth);
            const nextF2 = this.findPeak(Math.max(700, nextF1 + 350), 3200, binWidth);

            //F1とF2を新しい値へ数値分近づける
            this.f1 += (nextF1 - this.f1) * (this.f1 ? 0.4 : 1);
            this.f2 += (nextF2 - this.f2) * (this.f2 ? 0.4 : 1);

            //最も近い母音を判定
            vowel = this.findVowel(this.f1, this.f2);
        }

        //母音が判定できた場合、その母音の口形状データを取得
        const shape = vowel ? vowelProfiles[vowel] : undefined;

        //音量を口形状の適用強度へ変換
        const strength = Math.min(1, this.volume * 2);

        //目標とする口の開きと形を計算
        const targetOpen = (shape?.open ?? 0) * strength;
        const targetForm = (shape?.form ?? 0) * strength;

        //口の開きと形を目標値へ数値分ずつ近づける（滑らかな口パクの再現）
        this.mouthOpen += (targetOpen - this.mouthOpen) * 0.35;
        this.mouthForm += (targetForm - this.mouthForm) * 0.35;

        //解析結果を返す
        return {
            volume: this.volume,
            vowel,
            mouthOpen: this.mouthOpen,
            mouthForm: this.mouthForm,
        };
    }

    //音声スペクトルからF1・F2候補となる強い周波数を探す処理
    private findPeak(minHz: number, maxHz: number, binWidth: number): number {
        const spectrum = this.spectrum!;
        const start = Math.max(0, Math.ceil(minHz / binWidth));
        const end = Math.min(spectrum.length - 1, Math.floor(maxHz / binWidth));
        const radius = Math.max(1, Math.round(120 / binWidth));
        let peak = start;
        let peakEnergy = -1;

        //探索範囲内のすべての周波数位置を確認
        for (let i = start; i <= end; i++) {
            let energy = 0;

            //スペクトル値を合計。全体の音の範囲を検出
            for (let j = Math.max(start, i - radius); j <= Math.min(end, i + radius); j++) {
                energy += spectrum[j]!;
            }

            if (energy > peakEnergy) {
                peak = i;
                peakEnergy = energy;
            }
        }

        //配列位置をHzへ戻して返す
        return peak * binWidth;
    }

    //F1・F2を基準値と比較し「あ・い・う・え・お」の母音を決める処理
    private findVowel(f1: number, f2: number): Vowel {
        let result: Vowel = "a";
        let shortestDistance = Infinity;

        //登録されている5つの母音を順番に調べる
        for (const vowel of Object.keys(vowelProfiles) as Vowel[]) {
            const profile = vowelProfiles[vowel];
            const distance = Math.log(f1 / profile.f1) ** 2 + Math.log(f2 / profile.f2) ** 2;

            if (distance < shortestDistance) {
                result = vowel;
                shortestDistance = distance;
            }
        }

        //最も近かった母音を返す
        return result;
    }

    //音声解析を停止し、使用していたリソースと状態を初期化
    stop(): void {
        this.source?.disconnect();
        this.analyser?.disconnect();

        if (this.context) {
            void this.context.close().catch(() => undefined);
        }

        this.context = undefined;
        this.source = undefined;
        this.analyser = undefined;
        this.samples = undefined;
        this.spectrum = undefined;
        this.volume = 0;
        this.mouthOpen = 0;
        this.mouthForm = 0;
        this.f1 = 0;
        this.f2 = 0;
    }
}
