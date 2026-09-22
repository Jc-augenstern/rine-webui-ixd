import * as THREE from "three";
import type { StarUniforms } from "./star-field";
import { createNebulaTexture } from "./nebula-texture";
import { GALAXY_FLOW_GLSL } from "./galaxy-interaction";

/** The full contrast cloud river is transported by persistent material coordinates.
 * The atlas is sampled once at its original resolution, never repeatedly blurred. */
export function createAtmosphere(uniforms: StarUniforms) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uNebula: { value: createNebulaTexture() } },
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uAspect;
      uniform vec2 uPointer;
      uniform float uFocus;
      uniform sampler2D uNebula;
      uniform vec2 uTarget;
      ${GALAXY_FLOW_GLSL}
      void main() {
        vec2 cover = vec2(min(1.0, uAspect / (5. / 3.)), min(1.0, (5. / 3.) / uAspect));
        vec2 uv = (vUv - .5) * cover * (.88 - uFocus * .13) + .5;
        uv += vec2(uPointer.x, -uPointer.y) * .00405;
        uv += vec2(uTarget.x - .5, .5 - uTarget.y) * uFocus * .075;
        vec2 materialUv = vec2(uv.x, 1. - uv.y);
        vec2 displacement = galaxyFlow(materialUv).zw;
        uv -= displacement * vec2(1., -1.);
        vec3 color = texture2D(uNebula, uv).rgb;
        // Keep text legible while leaving the entire diagonal river visible.
        float shade = 1.0 - .23 * exp(-length((vUv - vec2(.13,.78)) * vec2(2.,3.)));
        float edge = 1.0 - .22 * smoothstep(.32,.72,length(vUv-.5));
        color *= shade * edge * (1.0 - uFocus * .14);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
