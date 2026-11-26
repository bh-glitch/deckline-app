import type { HTMLAttributes } from 'react';
import { useCanvasFrame } from './frameLoop';

type Draw = Parameters<typeof useCanvasFrame>[0];

/** Sized wrapper + absolutely positioned canvas. Size comes from CSS on the wrapper (className/style). */
export function FrameCanvas({ draw, className = '', ...rest }: { draw: Draw } & HTMLAttributes<HTMLDivElement>) {
  const ref = useCanvasFrame(draw);
  return (
    <div className={`cv-wrap ${className}`} {...rest}>
      <canvas ref={ref} />
    </div>
  );
}
