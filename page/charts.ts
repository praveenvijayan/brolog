export class Sparkline {
  private points: { time: number; value: number }[] = [];
  constructor(private canvas: HTMLCanvasElement) {
    new ResizeObserver(() => this.draw()).observe(canvas);
  }
  add(time: number, value: number) {
    this.points.push({ time, value });
    this.points = this.points.filter((p) => p.time >= time - 60000);
    this.draw();
  }
  clear() {
    this.points = [];
    this.draw();
  }
  private draw() {
    const { canvas } = this;
    const width = canvas.clientWidth,
      height = canvas.clientHeight,
      dpr = devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const c = canvas.getContext("2d");
    if (!c) return;
    c.scale(dpr, dpr);
    c.strokeStyle = "#393a3c";
    c.lineWidth = 1;
    for (const percent of [0, 50, 100]) {
      const y = 8 + (height - 16) * (1 - percent / 100);
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(width, y);
      c.stroke();
    }
    if (!this.points.length) return;
    const last = this.points.at(-1)!.time;
    c.strokeStyle = "#eb6c36";
    c.lineWidth = 2;
    c.beginPath();
    this.points.forEach((p, i) => {
      const x = width * (1 - (last - p.time) / 60000),
        y = 8 + (height - 16) * (1 - p.value / 100);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.stroke();
  }
}
