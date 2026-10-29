import { useEffect, useRef, useState } from 'react';
import { liquidFragSource } from './liquid-frag';
import { parseLogoImage } from './parse-logo-image';

// The Reality Capture "ribbon R" rendered as liquid metal, using the shader
// from paper-design/liquid-logo (see the two ported files beside this one).
// The WebGL setup follows that repo's canvas.tsx, trimmed to what this app
// needs: no upload UI, no toast library, and two additions --
//  - reduced motion: under prefers-reduced-motion the mark renders a single
//    still frame instead of flowing;
//  - fallback: without WebGL2 (or while the texture is being built) the
//    static artwork stays visible, so the brand never disappears.
//
// The mark's silhouette comes from public/branding/logo-r-mask.png, a clean
// mask cut from the official artwork.

const VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_position;
out vec2 vUv;
void main() {
    vUv = .5 * (a_position + 1.);
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

export interface LiquidParams {
  patternScale: number;
  refraction: number;
  edge: number;
  patternBlur: number;
  liquid: number;
  speed: number;
}

// The original repo's defaults.
const DEFAULT_LIQUID: LiquidParams = {
  patternScale: 2, refraction: 0.015, edge: 0.4, patternBlur: 0.005, liquid: 0.07, speed: 0.3,
};

type RGB = [number, number, number];
// Accepts a hex colour or the name of an "R G B" theme token (e.g.
// --rc-metal-hi), so the metal follows the active palette.
const toRgb = (color: string): RGB => {
  if (color.startsWith('--')) {
    const parts = getComputedStyle(document.documentElement).getPropertyValue(color).trim().split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  const n = parseInt(color.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function LiquidLogo({
  mask = '/branding/logo-r-mask.png',
  // Shader uniforms, not CSS: the original repo's chrome tones. Callers pass
  // theme colours. ds-allow-hardcode
  highlight = '#FAFAFF', // ds-allow-hardcode
  shadow = '#1A1A1A', // ds-allow-hardcode
  params = DEFAULT_LIQUID,
  label = 'Reality Capture',
  className = '',
}: {
  mask?: string;
  /** The metal's light tone: hex, or an R G B theme token name. */
  highlight?: string;
  /** The metal's dark tone: hex, or an R G B theme token name. */
  shadow?: string;
  params?: LiquidParams;
  label?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!canvas || !gl) { setFailed(true); return; }

    let cancelled = false;
    let frame = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const compile = (src: string, type: number) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('LiquidLogo shader:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(VERTEX_SHADER, gl.VERTEX_SHADER);
    const fs = compile(liquidFragSource, gl.FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vs || !fs || !program) { setFailed(true); return; }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { setFailed(true); return; }
    gl.useProgram(program);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(u('u_edge'), params.edge);
    gl.uniform1f(u('u_patternBlur'), params.patternBlur);
    gl.uniform1f(u('u_patternScale'), params.patternScale);
    gl.uniform1f(u('u_refraction'), params.refraction);
    gl.uniform1f(u('u_liquid'), params.liquid);
    gl.uniform3fv(u('u_color1'), toRgb(highlight));
    gl.uniform3fv(u('u_color2'), toRgb(shadow));

    parseLogoImage(mask).then(({ imageData }) => {
      if (cancelled) return;
      const side = 1000;
      canvas.width = side * devicePixelRatio;
      canvas.height = side * devicePixelRatio;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(u('u_ratio'), 1);
      gl.uniform1f(u('u_img_ratio'), imageData.width / imageData.height);

      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imageData.width, imageData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData.data);
      gl.uniform1i(u('u_image_texture'), 0);

      let total = 0;
      let last = performance.now();
      const draw = (now: number) => {
        total += (now - last) * params.speed;
        last = now;
        gl.uniform1f(u('u_time'), total);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!reduced) frame = requestAnimationFrame(draw);
      };
      // Reduced motion: one representative still frame, no loop.
      if (reduced) { total = 1500; draw(last); } else { frame = requestAnimationFrame(draw); }
      setReady(true);
    }).catch(() => setFailed(true));

    return () => {
      // Free what this run created, but never lose the context itself: the
      // canvas outlives the effect (React StrictMode re-runs it on the same
      // element), and a lost context can't compile shaders again.
      cancelled = true;
      cancelAnimationFrame(frame);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buffer);
    };
    // Shader inputs are fixed for the life of the mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div role="img" aria-label={label} className={`relative ${className}`}>
      {(!ready || failed) && (
        <img src="/logo-mark.png" alt="" aria-hidden="true" className="absolute inset-0 m-auto w-1/2 h-auto rounded-[30%]" />
      )}
      {!failed && <canvas ref={canvasRef} aria-hidden="true" className={`block w-full h-full transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`} />}
    </div>
  );
}
