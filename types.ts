
export interface FluidConfig {
  particleRadius: number;
  visualRatio: number; // Smoothness: visual/physics ratio. Higher = smaller physics radius = more visual overlap = smoother look
  viscosity: number;
  gravity: number;
  restDensity: number;
  stiffness: number;
  surfaceTension: number;       // Surface tension / cohesion strength (0 - 1.0)
  maxParticles: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  boundarySize: number;
  renderMode: 'surface' | 'dot';
  renderScale: number;
  // Rendering debug controls
  blurRadius: number;
  blurDepthFalloff: number;
  showContainer: boolean;
  // Advanced rendering parameters
  ior: number;                    // Index of refraction (1.0 - 3.0)
  refractionStrength: number;     // Refraction offset (0 - 0.2)
  fresnelPower: number;           // Fresnel exponent (>0, typically 0.1 - 20)
  fresnelIntensity: number;       // Fresnel brightness (0 - 0.5)
  fresnelBias: number;            // Fresnel base value (-0.5 - 0.5)
  specularPower: number;          // Specular sharpness (4 - 128)
  specularIntensity: number;      // Specular brightness (0 - 1)
  edgeSampleRadius: number;       // Edge detection radius (1 - 5)
  edgeSmoothness: number;         // Edge blend smoothness (1 - 8)
  depthZOffset: number;           // Depth sphere offset (0.1 - 1.0)
  thicknessIntensity: number;     // Thickness contribution (0 - 0.2)
  absorptionDensity: number;      // Water absorption density (0 - 10)
  waterTintR: number;             // Water color tint R (0 - 1.0)
  waterTintG: number;             // Water color tint G (0 - 1.0)
  waterTintB: number;             // Water color tint B (0 - 1.0)
  reflectionIntensity: number;    // HDRI reflection intensity (0 - 5.0)
}

export interface Particle {
  id: number;
  position: [number, number, number];
  velocity: [number, number, number];
  oldPosition: [number, number, number];
  lambda: number;
  density: number;
}
