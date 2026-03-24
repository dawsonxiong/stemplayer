export class MixRecorder {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private source: AudioNode;

  constructor(ctx: AudioContext, source: AudioNode) {
    this.ctx = ctx;
    this.source = source;
    this.destination = ctx.createMediaStreamDestination();
  }

  start(): void {
    // Connect source to recording destination
    this.source.connect(this.destination);

    this.chunks = [];
    this.recorder = new MediaRecorder(this.destination.stream, {
      mimeType: this.getSupportedMimeType(),
    });

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.recorder.start(100); // Collect data every 100ms
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        reject(new Error("Not recording"));
        return;
      }

      this.recorder.onstop = () => {
        const mimeType = this.recorder?.mimeType || "audio/webm";
        const blob = new Blob(this.chunks, { type: mimeType });
        this.chunks = [];

        // Disconnect recording tap
        try {
          this.source.disconnect(this.destination);
        } catch {
          // May already be disconnected
        }

        resolve(blob);
      };

      this.recorder.stop();
    });
  }

  get isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  private getSupportedMimeType(): string {
    const types = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return "audio/webm";
  }

  /** Download the recorded blob as a file */
  static download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
