import { WORDMARK_EN, WORDMARK_EN_WIDTH, WORDMARK_HE, WORDMARK_HE_WIDTH } from "./wordmark-paths";

// Server-rendered, CSS-only: a vein draws itself across black and becomes the wordmark.
// Total runtime 0.96 s; it never waits for JavaScript.
export default function Preloader() {
  const heX = (1000 - WORDMARK_HE_WIDTH) / 2;
  const enX = (1000 - WORDMARK_EN_WIDTH) / 2;
  return (
    <div className="preloader" aria-hidden="true" data-preloader>
      <svg viewBox="0 0 1000 400" role="presentation">
        <g className="veins">
          <path
            className="vein"
            pathLength={1}
            d="M-30 312 C 70 296, 140 336, 232 300 S 360 214, 468 246 S 590 300, 684 236 S 846 160, 1030 196"
          />
          <path className="vein b" pathLength={1} d="M232 300 C 270 334, 318 352, 396 378 S 470 392, 520 396" />
          <path className="vein c" pathLength={1} d="M684 236 C 712 200, 748 178, 790 128 S 836 70, 868 40" />
        </g>
        <g transform={`translate(${heX.toFixed(1)} 238)`}>
          <path className="word" d={WORDMARK_HE} />
        </g>
        <g transform={`translate(${enX.toFixed(1)} 306)`}>
          <path className="word-en" d={WORDMARK_EN} />
        </g>
      </svg>
    </div>
  );
}
