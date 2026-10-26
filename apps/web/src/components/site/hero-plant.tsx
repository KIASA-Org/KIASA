"use client";

import { useEffect, useRef } from "react";
import { STRIDE, plantCloud } from "./plant-cloud";

/** The hero's background: the KIASA leaf as a plant of small points of light,
 * turning slowly on a low mound of soil, as the model's hero turns its plant.
 * The logo shows the plant from straight above, so the plant is built lying
 * that way (plant-cloud.ts) and the camera looks down on it as it turns, like a
 * plant on a turntable: whichever way it faces, the upper side of its leaves
 * shows, never a back the drawing does not have. It stands in the room above
 * the headline, so no text covers it. Its leaves glow a deep green that
 * breathes. Its dew holds still, as dew does: clear water sitting on the
 * leaves, hiding what lies behind it, giving back only the sun, whose glints
 * travel over the drops as the plant turns under it.
 *
 * It is drawn with WebGL in two passes a frame: first the dew's surfaces, into
 * depth alone, then every point. It is built once the loading mark has gone
 * and fades in, pauses with the hero's button, sleeps while the hero is off
 * screen, and holds one still view for reduced motion. Without WebGL the hero
 * is simply dark. */

/** Seconds for one full turn. */
const TURN = 40;
/** The turn the plant first shows, and the one held for reduced motion (radians). */
const START = 0, STILL = 0.6;
/** How high the camera looks down on the plant from (radians above the ground), and how far away it is (logo pixels). */
const TILT = 0.27, CAMERA = 3000;
/** The base dot, in CSS pixels, and the overall strength of the light. */
const DOT = 2.3, GLOW = 0.56;
/** The drawing's pale ink; a leaf's green, from a deep emerald to a luminous
 * jade; the sprout's fresh green; the sun, a warm white; and the sky that dew
 * gives back at its edge, a slight blue. */
const INK = [0.925, 1, 0.953], DEEP = [0.04, 0.54, 0.37], JADE = [0.42, 1, 0.78], SPROUT = [0.8, 1, 0.6], SUN = [1, 0.97, 0.88], SKY = [0.5, 0.82, 1];
/** How far behind its own front a drop starts to hide what lies behind it, in
 * depth (a logo pixel is 1/1600), so its own surface is never hidden. */
const SEAL = 0.004;

const VERTEX = `
attribute vec3 a_point;
attribute vec4 a_look, a_water;
uniform vec2 u_turn, u_tilt, u_root, u_canvas;
uniform float u_scale, u_camera, u_dot, u_time, u_hide, u_seal;
varying float v_light, v_tone, v_sun, v_sky, v_clear;
// Turns a point or a direction with the plant, then tilts it with the camera:
// x to the right, y up, z toward the viewer.
vec3 view(vec3 v) {
  float x = v.x * u_turn.x + v.z * u_turn.y;
  float z = v.z * u_turn.x - v.x * u_turn.y;
  return vec3(x, v.y * u_tilt.x - z * u_tilt.y, z * u_tilt.x + v.y * u_tilt.y);
}
void main() {
  float water = step(0.5, a_water.w);
  vec3 at = view(a_point), normal = view(a_water.xyz);
  // How nearly edge-on this part of a drop's surface is seen: 1 at its rim.
  float rim = pow(1.0 - abs(normal.z), 1.5);
  float grow = u_camera / (u_camera - at.z);
  // Nearer is in front. While hiding, only the body of each drop is drawn, a
  // little larger and set back by u_seal, so it covers what lies behind it but
  // not itself; its rim is left out, so at its edge the leaf still shows softly
  // through, as through the thin edge of real water.
  gl_Position = vec4((u_root + at.xy * grow * u_scale) / u_canvas * 2.0 - 1.0, clamp(u_seal - at.z / 1600.0, -1.0, 1.0), 1.0);
  gl_PointSize = max(1.0, u_dot * a_look.y * grow * (1.0 + 0.25 * u_hide));
  if (u_hide > 0.5 && (water < 0.5 || rim > 0.4)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  float depth = clamp(0.5 + at.z / 1100.0, 0.0, 1.0);
  float light = a_look.x * mix(0.38, 1.0, depth) * (0.84 + 0.16 * sin(u_time * 1.6 + a_look.w * 6.2832));
  // A leaf's green breathes: a slow glow passes out from the heart along the leaves.
  float leaf = step(0.5, a_look.z) * step(a_look.z, 1.99);
  light *= 1.0 + 0.22 * leaf * sin(u_time * 0.9 - length(a_point.xz) * 0.012);
  // Dew has no light of its own; it shows what is around it. Through its
  // middle the leaf's glow shows; toward its edge, seen at a glancing angle, it
  // gives back a little of the sky, a slight blue; and where its surface faces
  // halfway between the sun (high on the left) and the eye, the sun shines in
  // it, small and white. The sun stays where it is as the plant turns, so the
  // glints travel over the drops.
  float sun = pow(max(dot(normal, vec3(-0.2471, 0.3296, 0.9112)), 0.0), 32.0);
  float clear = (0.6 + 0.7 * (1.0 - rim)) * mix(0.45, 1.0, step(0.0, normal.z));
  v_light = mix(mix(light, light * clear + 3.2 * sun, water), 1.0, u_hide);
  v_sun = water * min(1.0, sun * 2.0);
  v_sky = water * rim * 0.65;
  v_clear = water;
  v_tone = a_look.z;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_ink, u_deep, u_jade, u_sprout, u_sun, u_sky;
uniform float u_glow;
varying float v_light, v_tone, v_sun, v_sky, v_clear;
void main() {
  float a = min(1.0, v_light * u_glow) * (1.0 - smoothstep(0.4, 1.0, length(gl_PointCoord - 0.5) * 2.0));
  if (a < 0.004) discard;
  vec3 colour = v_tone < 0.5 ? u_ink : v_tone < 1.99 ? mix(u_deep, u_jade, v_tone - 1.0) : v_tone > 2.5 ? u_sprout : u_jade;
  // Dew has no colour of its own: the leaf's glow through it, the sky toward its edge, and the sun on it.
  gl_FragColor = vec4(mix(mix(mix(colour, u_jade, v_clear), u_sky, v_sky), u_sun, v_sun) * a, a);
}`;

/** Each point's inputs to the shader: [name, floats, offset in floats]. */
const INPUTS = [["a_point", 3, 0], ["a_look", 4, 3], ["a_water", 4, 7]] as const;

/** Compiles and links the two shaders, or returns null where the browser cannot. */
function link(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) return null;
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** How far the plant reaches on screen over a whole turn, in logo pixels from
 * the ground under its heart: up, down, and out to either side. Only the plant
 * is measured, the first `count` points; its soil may run off the foot of the
 * hero, where it fades. */
function extent(points: Float32Array, count: number) {
  let top = 0, bottom = 0, side = 0;
  const lift = Math.cos(TILT), drop = Math.sin(TILT);
  for (let step = 0; step < 24; step++) {
    const cos = Math.cos((step * Math.PI) / 12), sin = Math.sin((step * Math.PI) / 12);
    for (let i = 0; i < count * STRIDE; i += STRIDE) {
      const x = points[i] * cos + points[i + 2] * sin, y = points[i + 1], z = points[i + 2] * cos - points[i] * sin;
      const grow = CAMERA / (CAMERA - (z * lift + y * drop)), up = (y * lift - z * drop) * grow;
      top = Math.max(top, up);
      bottom = Math.min(bottom, up);
      side = Math.max(side, Math.abs(x) * grow);
    }
  }
  return { top, bottom, side };
}

/** Where the plant stands in a canvas of this width, in CSS pixels: the ground
 * under its heart, and how many CSS pixels a logo pixel takes. It has the room
 * above the headline, which starts `stage` down, to itself: centred in it and
 * as large as the room allows, so no text ever covers it. On a wide screen it
 * may rise into the lower part of the header, below its links, and reach
 * across most of the page, since nothing stands beside it there. */
function place(width: number, header: number, stage: number, { top, bottom, side }: ReturnType<typeof extent>) {
  const wide = width >= 1024, ceiling = wide ? header - 22 : header + 8, floor = stage - (wide ? 4 : 8);
  const room = floor - ceiling;
  const scale = Math.min(room / (top - bottom), (width * (wide ? 0.9 : 0.96)) / (2 * side));
  const y = ceiling + (room - (top - bottom) * scale) / 2 + top * scale;
  return { x: width / 2, y, scale };
}

/** Sets the plant going in `canvas`, and returns what stops it. */
function grow(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: true, stencil: false, powerPreference: "low-power" });
  if (!gl) return () => {};
  const hero = canvas.closest(".hero");
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let cloud: ReturnType<typeof plantCloud> | undefined;
  let reach: ReturnType<typeof extent> | undefined;
  let uniform: (name: string) => WebGLUniformLocation | null = () => null;
  let ready = false, count = 0, waiting = 0, frame = 0, seen = true, last = 0, turned = 0;

  /** Everything the GPU holds; run again if the context is lost and given back. */
  const prepare = () => {
    const program = cloud && link(gl);
    if (!cloud || !program) return false;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, cloud.points, gl.STATIC_DRAW);
    for (const [name, size, offset] of INPUTS) {
      const input = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(input);
      gl.vertexAttribPointer(input, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    }
    uniform = name => gl.getUniformLocation(program, name);
    gl.uniform2f(uniform("u_tilt"), Math.cos(TILT), Math.sin(TILT));
    gl.uniform1f(uniform("u_camera"), CAMERA);
    gl.uniform1f(uniform("u_glow"), GLOW);
    gl.uniform3fv(uniform("u_ink"), INK);
    gl.uniform3fv(uniform("u_deep"), DEEP);
    gl.uniform3fv(uniform("u_jade"), JADE);
    gl.uniform3fv(uniform("u_sprout"), SPROUT);
    gl.uniform3fv(uniform("u_sun"), SUN);
    gl.uniform3fv(uniform("u_sky"), SKY);
    gl.enable(gl.BLEND);
    // Points of light add up where they gather, so the leaves glow.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    return true;
  };

  /** Matches the canvas to its box and the plant to the canvas. */
  const fit = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const header = parseFloat(getComputedStyle(canvas).getPropertyValue("--header")) || 72;
    // The headline's row: the plant keeps above it.
    const stage = hero?.querySelector<HTMLElement>(".hero-inner")?.offsetTop ?? height;
    const { x, y, scale } = place(width, header, stage, reach!);
    gl.uniform2f(uniform("u_canvas"), canvas.width, canvas.height);
    gl.uniform2f(uniform("u_root"), x * ratio, (height - y) * ratio);
    gl.uniform1f(uniform("u_scale"), scale * ratio);
    gl.uniform1f(uniform("u_dot"), DOT * ratio);
  };

  const draw = () => {
    const angle = reduce.matches ? STILL : START + (turned / TURN) * 2 * Math.PI;
    gl.uniform2f(uniform("u_turn"), Math.cos(angle), Math.sin(angle));
    gl.uniform1f(uniform("u_time"), turned);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // First the dew's surfaces, into depth alone, so each drop hides what lies behind it.
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.uniform1f(uniform("u_hide"), 1);
    gl.uniform1f(uniform("u_seal"), SEAL);
    gl.drawArrays(gl.POINTS, cloud!.water.first, cloud!.water.count);
    // Then every point, as it is seen.
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(uniform("u_hide"), 0);
    gl.uniform1f(uniform("u_seal"), 0);
    gl.drawArrays(gl.POINTS, 0, count);
  };

  const restore = () => {
    ready = prepare();
    if (!ready) return;
    fit();
    draw();
  };
  const intro = () => root.hasAttribute("data-kiasa-intro");
  /** Builds the plant, draws it and lets it fade in. */
  const start = () => {
    waiting = 0;
    cloud = plantCloud();
    count = cloud.points.length / STRIDE;
    reach = extent(cloud.points, cloud.plant);
    restore();
    canvas.toggleAttribute("data-grown", ready);
    settle();
  };

  const moving = () => ready && seen && !reduce.matches && !hero?.hasAttribute("data-paused") && !intro();
  const tick = (now: number) => {
    frame = 0;
    if (!moving()) return;
    // Only time spent moving counts, so a pause holds the plant, and its water, where they are.
    if (last) turned += Math.min(0.1, (now - last) / 1000);
    last = now;
    draw();
    frame = requestAnimationFrame(tick);
  };
  const settle = () => {
    // The plant is built after the loading mark has gone, in a task of its own,
    // so the work never holds up the mark or the page arriving after it.
    if (!cloud && !waiting && !intro()) waiting = window.setTimeout(start, 80);
    if (!moving()) {
      cancelAnimationFrame(frame);
      frame = 0;
      if (ready && reduce.matches) draw();
      return;
    }
    if (!frame) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };

  const resize = new ResizeObserver(() => {
    if (!ready) return;
    fit();
    draw();
  });
  resize.observe(canvas);
  const watcher = new IntersectionObserver(([entry]) => { seen = entry.isIntersecting; settle(); });
  watcher.observe(canvas);
  const changes = new MutationObserver(settle);
  if (hero) changes.observe(hero, { attributes: true, attributeFilter: ["data-paused"] });
  changes.observe(root, { attributes: true, attributeFilter: ["data-kiasa-intro"] });
  reduce.addEventListener("change", settle);
  const lose = (event: Event) => {
    event.preventDefault();
    ready = false;
    settle();
  };
  const regain = () => {
    restore();
    settle();
  };
  canvas.addEventListener("webglcontextlost", lose);
  canvas.addEventListener("webglcontextrestored", regain);
  settle();

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(waiting);
    resize.disconnect();
    watcher.disconnect();
    changes.disconnect();
    reduce.removeEventListener("change", settle);
    canvas.removeEventListener("webglcontextlost", lose);
    canvas.removeEventListener("webglcontextrestored", regain);
  };
}

export function HeroPlant() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => canvas.current ? grow(canvas.current) : undefined, []);
  return <canvas ref={canvas} className="hero-plant" aria-hidden="true" />;
}
