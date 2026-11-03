// Outline of the usage bar when it is merged with the chat box into one rounded box.
// Coordinates: x runs across, y runs down, origin at the bar's top-left corner.
(function (g) {
  function build(W, H, R, bw, strokeW) {
    const cover = Math.max(1, bw);        // how far the bar overlaps the chat box's top border
    const yc = H - cover;                 // chat box top edge
    const yL = yc + R;                    // where the chat box's straight sides begin
    const Rt = Math.min(R, H);            // bar's own top corner radius
    const e = bw + 1;                     // reach 1px past the chat box border so no hairline shows
    const Ri = Math.max(0, R - e);        // inside edge of the chat box's rounded corner
    const Hf = Math.max(H, yc + e);
    const n = (v) => +v.toFixed(2);

    // Solid area: the bar, plus the two little corner pieces that fill the gap
    // outside the chat box's rounded top corners.
    const fill = [
      `M0 ${n(yL)}`, `L0 ${n(Rt)}`, `A${n(Rt)} ${n(Rt)} 0 0 1 ${n(Rt)} 0`,
      `L${n(W - Rt)} 0`, `A${n(Rt)} ${n(Rt)} 0 0 1 ${n(W)} ${n(Rt)}`, `L${n(W)} ${n(yL)}`,
      `L${n(W - e)} ${n(yL)}`, `A${n(Ri)} ${n(Ri)} 0 0 0 ${n(W - R)} ${n(yc + e)}`,
      `L${n(W - R)} ${n(Hf)}`, `L${n(R)} ${n(Hf)}`, `L${n(R)} ${n(yc + e)}`,
      `A${n(Ri)} ${n(Ri)} 0 0 0 ${n(e)} ${n(yL)}`, "Z",
    ].join(" ");

    // The single outline: left side, top, right side. It meets the chat box's own sides.
    const h = strokeW / 2;
    const Rs = Math.max(0, Rt - h);
    const stroke = [
      `M${n(h)} ${n(yL)}`, `L${n(h)} ${n(Rt)}`, `A${n(Rs)} ${n(Rs)} 0 0 1 ${n(Rt)} ${n(h)}`,
      `L${n(W - Rt)} ${n(h)}`, `A${n(Rs)} ${n(Rs)} 0 0 1 ${n(W - h)} ${n(Rt)}`, `L${n(W - h)} ${n(yL)}`,
    ].join(" ");

    // A faint line between the usage row and the text field.
    const divider = `M${n(bw)} ${n(H - 0.5)} L${n(W - bw)} ${n(H - 0.5)}`;

    return { fill, stroke, divider, height: n(yL), cover };
  }
  g.ClaudeShape = { build };
})(typeof window !== "undefined" ? window : globalThis);
