// Depth shader - renders particle spheres to depth buffer
export const depthVertexShader = `
  uniform float uScale;
  uniform float uRadius;
  varying float vViewZ;
  void main() {
    vec4 mvPos = viewMatrix * modelMatrix * vec4(position, 1.0);
    vViewZ = mvPos.z;
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = (2400.0 * uScale * uRadius) / -mvPos.z;
  }
`;

// GPU Texture-based depth shader - reads positions from texture (no CPU readback)
export const depthVertexShaderGPU = `
  uniform float uScale;
  uniform float uRadius;
  uniform sampler2D tPosition;
  uniform vec2 uParticleRes;
  uniform int uParticleCount;
  attribute float particleIndex;
  varying float vViewZ;

  void main() {
    int idx = int(particleIndex);
    if (idx >= uParticleCount) {
      gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    // Calculate UV from particle index
    float fx = mod(particleIndex, uParticleRes.x);
    float fy = floor(particleIndex / uParticleRes.x);
    vec2 puv = (vec2(fx, fy) + 0.5) / uParticleRes;

    vec4 posData = texture2D(tPosition, puv);

    // Check if particle is active (w >= 0.5)
    if (posData.w < 0.5) {
      gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vec4 mvPos = viewMatrix * modelMatrix * vec4(posData.xyz, 1.0);
    vViewZ = mvPos.z;
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = (2400.0 * uScale * uRadius) / -mvPos.z;
  }
`;

export const createDepthFragmentShader = (zOffset: number) => `
  varying float vViewZ;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float zOffset = sqrt(1.0 - r2) * ${zOffset.toFixed(2)};
    gl_FragColor = vec4(vec3(vViewZ + zOffset), 1.0);
  }
`;

// Keep legacy export for compatibility
export const depthFragmentShader = createDepthFragmentShader(0.45);

// Bilateral blur shader - smooths depth buffer while preserving edges
export const blurVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const createBlurFragmentShader = (radius: number, depthFalloff: number) => `
  uniform sampler2D tDepth;
  uniform vec2 uTexSize;
  uniform vec2 uDir;
  varying vec2 vUv;

  void main() {
    float d = texture2D(tDepth, vUv).r;
    if (d == 0.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float sum = 0.0;
    float wSum = 0.0;
    float radius = ${radius.toFixed(1)};
    float depthFalloff = ${depthFalloff.toFixed(1)};
    float sigma = radius * radius / 2.0;

    for (float i = -${radius.toFixed(1)}; i <= ${radius.toFixed(1)}; i++) {
      float sD = texture2D(tDepth, vUv + i * uTexSize * uDir * 1.5).r;
      if (sD == 0.0) continue;
      float w_s = exp(-i*i/sigma);
      float w_r = exp(-(d-sD)*(d-sD)*depthFalloff);
      float w = w_s * w_r;
      sum += sD * w;
      wSum += w;
    }
    gl_FragColor = vec4(sum / max(wSum, 0.0001));
  }
`;

// Thickness shader - for volume/absorption effects
export const thicknessVertexShader = `
  uniform float uScale;
  uniform float uRadius;
  void main() {
    vec4 mvPos = viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = (2800.0 * uScale * uRadius) / -mvPos.z;
  }
`;

// GPU Texture-based thickness shader - reads positions from texture
export const thicknessVertexShaderGPU = `
  uniform float uScale;
  uniform float uRadius;
  uniform sampler2D tPosition;
  uniform vec2 uParticleRes;
  uniform int uParticleCount;
  attribute float particleIndex;

  void main() {
    int idx = int(particleIndex);
    if (idx >= uParticleCount) {
      gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    float fx = mod(particleIndex, uParticleRes.x);
    float fy = floor(particleIndex / uParticleRes.x);
    vec2 puv = (vec2(fx, fy) + 0.5) / uParticleRes;

    vec4 posData = texture2D(tPosition, puv);

    if (posData.w < 0.5) {
      gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }

    vec4 mvPos = viewMatrix * modelMatrix * vec4(posData.xyz, 1.0);
    gl_Position = projectionMatrix * mvPos;
    gl_PointSize = (2800.0 * uScale * uRadius) / -mvPos.z;
  }
`;

export const createThicknessFragmentShader = (intensity: number) => `
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vec3(${intensity.toFixed(3)} * (1.0 - d*2.0)), 1.0);
  }
`;

// Keep legacy export for compatibility
export const thicknessFragmentShader = createThicknessFragmentShader(0.05);

// Final composite shader - combines depth, normals, refraction
export const finalVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export interface FinalShaderParams {
  ior: number;
  refractionStrength: number;
  fresnelPower: number;
  fresnelIntensity: number;
  fresnelBias: number;
  specularPower: number;
  specularIntensity: number;
  edgeSampleRadius: number;
  edgeSmoothness: number;
  absorptionDensity: number;
  waterTintR: number;
  waterTintG: number;
  waterTintB: number;
  reflectionIntensity: number;
}

export const createFinalFragmentShader = (params: FinalShaderParams) => `
  uniform sampler2D tDepth;
  uniform sampler2D tThickness;
  uniform sampler2D tRefraction;
  uniform sampler2D tEnvMap;
  uniform mat4 uInvProj;
  uniform mat4 uViewMatrixInverse;
  uniform vec2 uRes;
  uniform float uExposure;
  uniform float uHasEnvMap;
  varying vec2 vUv;

  // Convert reflection direction to equirectangular UV coordinates
  vec2 dirToEquirectangular(vec3 dir) {
    // Normalize direction
    vec3 d = normalize(dir);
    // Calculate spherical coordinates
    float phi = atan(d.z, d.x);
    float theta = asin(clamp(d.y, -1.0, 1.0));
    // Convert to UV [0, 1]
    vec2 uv;
    uv.x = 0.5 + phi / (2.0 * 3.14159265359);
    uv.y = 0.5 + theta / 3.14159265359;
    return uv;
  }

  // ACES Filmic Tone Mapping
  vec3 applyACESToneMap(vec3 color) {
    const mat3 ACESInputMat = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777
    );
    const mat3 ACESOutputMat = mat3(
      1.60475, -0.10208, -0.00327,
      -0.53108, 1.10813, -0.07276,
      -0.07367, -0.00605, 1.07602
    );
    color = ACESInputMat * color;
    vec3 a = color * (color + 0.0245786) - 0.000090537;
    vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
    color = a / b;
    color = ACESOutputMat * color;
    return clamp(color, 0.0, 1.0);
  }

  vec3 linearToSRGB(vec3 color) {
    return pow(color, vec3(1.0 / 2.2));
  }

  vec3 uvToView(vec2 uv, float vZ) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    vec4 view = uInvProj * ndc;
    return (view.xyz / view.w) * (vZ / view.z);
  }

  // Schlick fresnel approximation with bias and smoothstep for smoother edges
  float schlickFresnel(float NdotV, float bias, float power) {
    float base = 1.0 - NdotV;
    // Use smoothstep to create softer transition
    float smoothBase = smoothstep(0.0, 1.0, base);
    return bias + (1.0 - bias) * pow(smoothBase, power);
  }

  void main() {
    float vZ = texture2D(tDepth, vUv).r;
    float thickness = texture2D(tThickness, vUv).r;
    vec3 bgRaw = texture2D(tRefraction, vUv).rgb;
    vec3 bgToned = applyACESToneMap(bgRaw * uExposure);
    vec3 bgFinal = linearToSRGB(bgToned);

    // No water - pass through background
    if (vZ == 0.0) {
      gl_FragColor = vec4(bgFinal, 1.0);
      return;
    }

    vec2 tex = 1.0 / uRes;
    float edgeRadius = ${params.edgeSampleRadius.toFixed(1)};

    // Edge detection with configurable radius
    float dR = texture2D(tDepth, vUv + vec2(tex.x * edgeRadius, 0.0)).r;
    float dL = texture2D(tDepth, vUv - vec2(tex.x * edgeRadius, 0.0)).r;
    float dT = texture2D(tDepth, vUv + vec2(0.0, tex.y * edgeRadius)).r;
    float dB = texture2D(tDepth, vUv - vec2(0.0, tex.y * edgeRadius)).r;

    float validNeighbors = 0.0;
    if (dR != 0.0) validNeighbors += 1.0;
    if (dL != 0.0) validNeighbors += 1.0;
    if (dT != 0.0) validNeighbors += 1.0;
    if (dB != 0.0) validNeighbors += 1.0;

    float edgeFactor = smoothstep(0.0, ${params.edgeSmoothness.toFixed(1)}, validNeighbors);

    // Normal reconstruction
    float dRn = texture2D(tDepth, vUv + vec2(tex.x, 0.0)).r;
    float dLn = texture2D(tDepth, vUv - vec2(tex.x, 0.0)).r;
    float dTn = texture2D(tDepth, vUv + vec2(0.0, tex.y)).r;
    float dBn = texture2D(tDepth, vUv - vec2(0.0, tex.y)).r;

    vec3 P = uvToView(vUv, vZ);
    vec3 Pr = uvToView(vUv + vec2(tex.x, 0.0), dRn != 0.0 ? dRn : vZ);
    vec3 Pl = uvToView(vUv - vec2(tex.x, 0.0), dLn != 0.0 ? dLn : vZ);
    vec3 Pt = uvToView(vUv + vec2(0.0, tex.y), dTn != 0.0 ? dTn : vZ);
    vec3 Pb = uvToView(vUv - vec2(0.0, tex.y), dBn != 0.0 ? dBn : vZ);
    vec3 dX = Pr - Pl;
    vec3 dY = Pt - Pb;
    vec3 N = normalize(cross(dX, dY));

    vec3 V = normalize(-P);
    float NdotV = max(0.0, dot(N, V));

    // Refraction with configurable IOR and strength
    float IOR = ${params.ior.toFixed(2)};
    vec3 refractDir = refract(-V, N, 1.0 / IOR);
    vec2 refrUv = vUv + refractDir.xy * ${params.refractionStrength.toFixed(3)};
    refrUv = clamp(refrUv, 0.0, 1.0);

    vec3 bg = texture2D(tRefraction, refrUv).rgb;

    // Beer-Lambert absorption - water absorbs light based on thickness
    // Water absorbs red faster than blue, creating blue-green tint at depth
    float absorptionDensity = ${params.absorptionDensity.toFixed(2)};
    vec3 absorptionCoeff = vec3(0.45, 0.08, 0.04) * absorptionDensity; // Red absorbs most, blue least
    vec3 absorption = exp(-absorptionCoeff * thickness * 30.0);

    // Apply water tint and absorption
    vec3 waterTint = vec3(${params.waterTintR.toFixed(2)}, ${params.waterTintG.toFixed(2)}, ${params.waterTintB.toFixed(2)});
    vec3 waterColor = bg * waterTint * absorption;

    // Add deep water color where absorption is strong
    vec3 deepWaterColor = vec3(0.02, 0.08, 0.15); // Dark blue-green
    float depthBlend = 1.0 - min(1.0, (absorption.r + absorption.g + absorption.b) / 3.0);
    waterColor = mix(waterColor, deepWaterColor, depthBlend * 0.7);

    // Improved Fresnel with Schlick approximation and smoothstep
    float fresnelBias = ${params.fresnelBias.toFixed(3)};
    float fresnelPower = ${params.fresnelPower.toFixed(1)};

    // Clamp NdotV to prevent extreme fresnel at grazing angles
    // Also attenuate fresnel based on edgeFactor to avoid bright outline at water boundary
    float clampedNdotV = max(0.15, NdotV); // Prevent NdotV from going too low
    float fresnel = schlickFresnel(clampedNdotV, fresnelBias, fresnelPower);

    // Attenuate fresnel at edges where normal reconstruction is unreliable
    fresnel *= edgeFactor;

    // Calculate reflection direction in world space
    vec3 viewNormal = N;
    vec3 reflectDir = reflect(-V, viewNormal);
    // Transform reflection direction from view space to world space
    vec3 worldReflectDir = (uViewMatrixInverse * vec4(reflectDir, 0.0)).xyz;

    // Sample HDRI for reflection color (single sample for performance)
    vec3 reflectionColor;
    float reflectionIntensity = ${params.reflectionIntensity.toFixed(2)};
    if (uHasEnvMap > 0.5) {
      vec2 envUv = dirToEquirectangular(worldReflectDir);
      reflectionColor = texture2D(tEnvMap, envUv).rgb;
    } else {
      reflectionColor = vec3(0.7, 0.85, 1.0); // Fallback sky color
    }

    // Apply reflection with both base amount and fresnel enhancement
    // Base reflection: always visible, controlled by reflectionIntensity
    // Fresnel adds extra reflection at grazing angles
    float fresnelIntensity = ${params.fresnelIntensity.toFixed(3)};
    float baseReflection = reflectionIntensity * 0.15; // Base reflection amount
    float fresnelReflection = fresnel * fresnelIntensity * reflectionIntensity;
    float totalReflection = min(1.0, baseReflection + fresnelReflection) * edgeFactor;
    waterColor = mix(waterColor, reflectionColor, totalReflection);

    // Specular highlight
    vec3 L = normalize(vec3(0.5, 1.0, 0.3));
    vec3 H = normalize(L + V);
    float spec = pow(max(0.0, dot(N, H)), ${params.specularPower.toFixed(1)}) * ${params.specularIntensity.toFixed(2)};
    waterColor += vec3(1.0) * spec;

    waterColor = applyACESToneMap(waterColor * uExposure);
    waterColor = linearToSRGB(waterColor);

    // Blend at edges
    vec3 finalColor = mix(bgFinal, waterColor, edgeFactor);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// Legacy export with default values
export const finalFragmentShader = createFinalFragmentShader({
  ior: 1.33,
  refractionStrength: 0.05,
  fresnelPower: 0.4,
  fresnelIntensity: 0.02,
  fresnelBias: 0.0,
  specularPower: 32.0,
  specularIntensity: 0.25,
  edgeSampleRadius: 2.0,
  edgeSmoothness: 5.0,
  absorptionDensity: 0,
  waterTintR: 0.98,
  waterTintG: 0.99,
  waterTintB: 1.0,
  reflectionIntensity: 1.0
});
