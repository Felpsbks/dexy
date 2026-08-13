import { useEffect, useRef, useState } from "react";

const GIF_RE = /\.gif(\?|$)/i;

// Animated (GIF) avatars only actually animate while the person is
// speaking — frozen on a still frame otherwise, the same trick Discord uses
// for animated avatars in voice. Always on here, no toggle.
//
// Browsers can't pause a GIF <img> mid-playback, so instead of hiding it we
// keep it decoding continuously (off-screen behind an overlay) and paint a
// canvas snapshot of whatever frame it's on. Toggling the snapshot's
// opacity is what reads as "starting/stopping" — when speech ends we
// capture the frame right at that moment, so it freezes naturally instead
// of snapping back to frame one.
export function SpeakingAwareAvatar({
  src,
  alt = "",
  isSpeaking,
  className,
}: {
  src: string;
  alt?: string;
  isSpeaking: boolean;
  className?: string;
}) {
  const isGif = GIF_RE.test(src);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameReady, setFrameReady] = useState(false);

  useEffect(() => {
    if (!isGif || isSpeaking) return;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const captureFrame = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !img.naturalWidth) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      setFrameReady(true);
    };

    if (img.complete && img.naturalWidth) captureFrame();
    else img.addEventListener("load", captureFrame, { once: true });
    return () => img.removeEventListener("load", captureFrame);
  }, [isGif, isSpeaking, src]);

  if (!isGif) {
    return <img src={src} alt={alt} className={className} />;
  }

  // The caller's className (size, rounding, ring, ...) goes on this wrapper
  // only — never on the img/canvas below. Earlier this was applied to the
  // canvas directly, and a caller passing "relative ... w-20 h-20" (DmCall's
  // voice-only tiles do) collided with the "absolute" needed to overlay it:
  // Tailwind defines `.relative` after `.absolute` in its generated CSS, so
  // it silently won regardless of class order, knocking the canvas out of
  // position and leaving two stacked circles instead of one overlaid pair.
  return (
    <span className={`relative inline-block overflow-hidden ${className ?? ""}`}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-150 ${
          isSpeaking || !frameReady ? "opacity-0" : "opacity-100"
        }`}
      />
    </span>
  );
}
