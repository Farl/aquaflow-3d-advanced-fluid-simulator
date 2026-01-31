
// GPU Physics Shaders for SPH Fluid Simulation
// Uses GPGPU (General Purpose GPU) computing via WebGL textures

// Vertex shader for full-screen quad (used for all compute passes)
export const computeVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Fragment shader: Apply gravity and predict positions
export const integrateShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform vec3 uGravity;
  uniform float uDt;
  uniform vec2 uResolution;

  varying vec2 vUv;

  void main() {
    vec4 pos = texture2D(tPosition, vUv);
    vec4 vel = texture2D(tVelocity, vUv);

    // Skip inactive particles (w < 0.5 means inactive)
    if (pos.w < 0.5) {
      gl_FragColor = pos;
      return;
    }

    // Apply gravity to velocity and update position
    vec3 newVel = vel.xyz + uGravity * uDt;
    vec3 newPos = pos.xyz + newVel * uDt;

    gl_FragColor = vec4(newPos, pos.w);
  }
`;

// Fragment shader: Update velocities after integration
export const velocityIntegrateShader = `
  precision highp float;

  uniform sampler2D tVelocity;
  uniform vec3 uGravity;
  uniform float uDt;

  varying vec2 vUv;

  void main() {
    vec4 vel = texture2D(tVelocity, vUv);
    vec3 newVel = vel.xyz + uGravity * uDt;
    gl_FragColor = vec4(newVel, vel.w);
  }
`;

// Fragment shader: Build spatial hash grid cell counts
export const gridBuildShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform float uCellSize;
  uniform vec3 uGridMin;
  uniform vec3 uGridDim;
  uniform vec2 uParticleRes;

  varying vec2 vUv;

  // Hash function to convert 3D cell to 1D index
  int hashCell(ivec3 cell) {
    // Wrap negative cells
    ivec3 wrapped = ivec3(
      int(mod(float(cell.x), uGridDim.x)),
      int(mod(float(cell.y), uGridDim.y)),
      int(mod(float(cell.z), uGridDim.z))
    );
    return wrapped.x + wrapped.y * int(uGridDim.x) + wrapped.z * int(uGridDim.x) * int(uGridDim.y);
  }

  void main() {
    // This shader counts particles per cell
    // Output: R = particle count in this cell

    int cellIndex = int(gl_FragCoord.x) + int(gl_FragCoord.y) * int(uGridDim.x);
    int totalCells = int(uGridDim.x * uGridDim.y * uGridDim.z);

    if (cellIndex >= totalCells) {
      gl_FragColor = vec4(0.0);
      return;
    }

    // Convert linear index back to 3D cell
    int gx = int(mod(float(cellIndex), uGridDim.x));
    int gy = int(mod(float(cellIndex / int(uGridDim.x)), uGridDim.y));
    int gz = cellIndex / int(uGridDim.x * uGridDim.y);

    float count = 0.0;

    // Count particles in this cell
    for (float py = 0.0; py < uParticleRes.y; py++) {
      for (float px = 0.0; px < uParticleRes.x; px++) {
        vec2 puv = (vec2(px, py) + 0.5) / uParticleRes;
        vec4 pos = texture2D(tPosition, puv);

        if (pos.w < 0.5) continue;

        ivec3 cell = ivec3(floor((pos.xyz - uGridMin) / uCellSize));
        if (cell.x == gx && cell.y == gy && cell.z == gz) {
          count += 1.0;
        }
      }
    }

    gl_FragColor = vec4(count, 0.0, 0.0, 1.0);
  }
`;

// Fragment shader: Density calculation using SPH kernels
export const createDensityShader = (maxNeighbors: number = 64) => `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform float uKernelRadius;
  uniform float uRestDensity;
  uniform vec2 uParticleRes;
  uniform int uParticleCount;

  varying vec2 vUv;

  // SPH Poly6 kernel for density
  float poly6(float r2, float h2) {
    if (r2 >= h2) return 0.0;
    float diff = h2 - r2;
    // 315 / (64 * PI * h^9)
    float h9 = h2 * h2 * h2 * h2 * sqrt(h2);
    return 315.0 / (64.0 * 3.14159265 * h9) * diff * diff * diff;
  }

  void main() {
    vec4 pos_i = texture2D(tPosition, vUv);

    // Skip inactive particles
    if (pos_i.w < 0.5) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }

    float h = uKernelRadius;
    float h2 = h * h;
    float density = 0.0;

    // Self contribution
    density += poly6(0.0, h2);

    // Loop through all particles for neighbor search
    // In production, this would use spatial hashing
    for (int j = 0; j < ${maxNeighbors * 100}; j++) {
      if (j >= uParticleCount) break;

      float jx = mod(float(j), uParticleRes.x);
      float jy = floor(float(j) / uParticleRes.x);
      vec2 juv = (vec2(jx, jy) + 0.5) / uParticleRes;

      // Skip self
      if (abs(juv.x - vUv.x) < 0.0001 && abs(juv.y - vUv.y) < 0.0001) continue;

      vec4 pos_j = texture2D(tPosition, juv);
      if (pos_j.w < 0.5) continue;

      vec3 diff = pos_i.xyz - pos_j.xyz;
      float r2 = dot(diff, diff);

      if (r2 < h2) {
        density += poly6(r2, h2);
      }
    }

    // Output: R = density, G = pressure (computed from density)
    float pressure = max(0.0, density - uRestDensity);
    gl_FragColor = vec4(density, pressure, 0.0, 1.0);
  }
`;

// Fragment shader: Pressure, collision and surface tension forces
export const createForceShader = (maxNeighbors: number = 64) => `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform sampler2D tDensity;
  uniform float uKernelRadius;
  uniform float uStiffness;
  uniform float uRestDensity;
  uniform float uMinDist;
  uniform float uCollisionStrength;
  uniform float uSurfaceTension;
  uniform float uCohesionRadius;  // Cohesion kernel radius (based on particle size)
  uniform vec2 uParticleRes;
  uniform int uParticleCount;

  varying vec2 vUv;

  // SPH Spiky gradient kernel for pressure
  vec3 spikyGrad(vec3 r, float d, float h) {
    if (d >= h || d < 0.001) return vec3(0.0);
    // -45 / (PI * h^6) * (h - d)^2 * r/d
    float h6 = h * h * h * h * h * h;
    float coeff = -45.0 / (3.14159265 * h6);
    float term = (h - d) * (h - d);
    return coeff * term * (r / d);
  }

  // Akinci cohesion kernel for surface tension
  // Key feature: REPULSION at close range, ATTRACTION at moderate range
  // This prevents particle clumping and explosion
  // Reference: Akinci et al. "Versatile Surface Tension and Adhesion for SPH Fluids" 2013
  float cohesionKernel(float d, float h) {
    if (d >= h || d < 0.0001) return 0.0;

    float h2 = h * h;
    float h3 = h2 * h;
    float h6 = h3 * h3;
    float h9 = h6 * h3;

    // Normalization constant: 32 / (pi * h^9)
    float k = 32.0 / (3.14159265 * h9);
    float c = h6 / 64.0;

    float hMinusR = h - d;
    float hMinusR3 = hMinusR * hMinusR * hMinusR;
    float r3 = d * d * d;

    float W;
    if (d > 0.5 * h) {
      // Outer range: pure attraction
      W = k * hMinusR3 * r3;
    } else {
      // Inner range: can be negative (repulsion) when particles are too close
      W = k * 2.0 * hMinusR3 * r3 - c;
    }

    return W;
  }

  void main() {
    vec4 pos_i = texture2D(tPosition, vUv);
    vec4 density_i = texture2D(tDensity, vUv);

    // Skip inactive particles
    if (pos_i.w < 0.5) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float h = uKernelRadius;
    float h2 = h * h;

    // Pressure: directly use stiffness for clearer effect
    // stiffness controls how strongly particles resist compression
    float densityError = max(0.0, density_i.x - uRestDensity);
    float pressure_i = densityError * uStiffness * 0.0001;

    vec3 force = vec3(0.0);
    vec3 cohesionForce = vec3(0.0);
    int neighborCount = 0;

    // Loop through all particles
    for (int j = 0; j < ${maxNeighbors * 100}; j++) {
      if (j >= uParticleCount) break;

      float jx = mod(float(j), uParticleRes.x);
      float jy = floor(float(j) / uParticleRes.x);
      vec2 juv = (vec2(jx, jy) + 0.5) / uParticleRes;

      // Skip self
      if (abs(juv.x - vUv.x) < 0.0001 && abs(juv.y - vUv.y) < 0.0001) continue;

      vec4 pos_j = texture2D(tPosition, juv);
      if (pos_j.w < 0.5) continue;

      vec3 diff = pos_i.xyz - pos_j.xyz;
      float r2 = dot(diff, diff);
      float d = sqrt(r2);

      if (d < 0.001) continue;

      vec3 n = diff / d;

      if (d < h) {
        neighborCount++;

        // SPH pressure force - pushes particles apart when compressed
        vec3 kernelGrad = spikyGrad(diff, d, h);
        force += kernelGrad * pressure_i;
      }

      // Akinci surface tension using cohesion kernel
      // Use cohesion radius (based on particle size) instead of SPH kernel radius
      // This ensures cohesion force scales properly with particle size
      if (d < uCohesionRadius) {
        // The kernel naturally handles repulsion (close) vs attraction (far)
        float coh = cohesionKernel(d, uCohesionRadius);
        // Negative coh = repulsion, positive coh = attraction
        // Force direction: -n points toward neighbor
        cohesionForce -= n * coh;
      }

      // Soft collision - additional overlap prevention
      if (d < uMinDist) {
        float overlap = uMinDist - d;
        force += n * overlap * uCollisionStrength;
      }
    }

    // Apply surface tension with radius-based normalization
    // The Akinci kernel has 1/h^9 normalization which makes it extremely
    // sensitive to kernel radius. We compensate by scaling with h^2.
    // Reference radius of 2.0 gives consistent behavior across particle sizes.
    float refRadius = 2.0;
    float radiusScale = (uCohesionRadius * uCohesionRadius) / (refRadius * refRadius);
    float tensionScale = uSurfaceTension * 0.3 * radiusScale;
    vec3 tensionForce = cohesionForce * tensionScale;

    // Soft clamp to prevent extreme forces
    float tensionMag = length(tensionForce);
    float maxTension = 0.5 * radiusScale;  // Scale max tension with radius too
    if (tensionMag > maxTension) {
      tensionForce = tensionForce * (maxTension / tensionMag);
    }
    force += tensionForce;

    // Output force as position delta
    gl_FragColor = vec4(force, 1.0);
  }
`;

// Fragment shader: Apply forces to positions
export const applyForcesShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tForce;

  varying vec2 vUv;

  void main() {
    vec4 pos = texture2D(tPosition, vUv);
    vec4 force = texture2D(tForce, vUv);

    if (pos.w < 0.5) {
      gl_FragColor = pos;
      return;
    }

    gl_FragColor = vec4(pos.xyz + force.xyz, pos.w);
  }
`;

// Fragment shader: Boundary constraints
export const boundaryShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tVelocity;
  uniform float uBoundary;
  uniform float uBoundaryOffset;
  uniform float uWallRepelDist;

  varying vec2 vUv;

  void main() {
    vec4 pos = texture2D(tPosition, vUv);
    vec4 vel = texture2D(tVelocity, vUv);

    if (pos.w < 0.5) {
      gl_FragColor = pos;
      return;
    }

    vec3 newPos = pos.xyz;
    float minBound = -uBoundary + uBoundaryOffset;
    float maxBound = uBoundary - uBoundaryOffset;

    // Soft repulsion near walls
    for (int a = 0; a < 3; a++) {
      float p = a == 0 ? newPos.x : (a == 1 ? newPos.y : newPos.z);
      float distToMin = p - minBound;
      float distToMax = maxBound - p;

      float delta = 0.0;
      if (distToMin < uWallRepelDist) delta += 0.1 * (uWallRepelDist - distToMin);
      if (distToMax < uWallRepelDist) delta -= 0.1 * (uWallRepelDist - distToMax);

      if (a == 0) newPos.x += delta;
      else if (a == 1) newPos.y += delta;
      else newPos.z += delta;
    }

    // Hard boundary clamp
    newPos = clamp(newPos, vec3(minBound), vec3(maxBound));

    gl_FragColor = vec4(newPos, pos.w);
  }
`;

// Fragment shader: Update velocities from position change
export const velocityUpdateShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform sampler2D tOldPosition;
  uniform sampler2D tVelocity;
  uniform float uDt;
  uniform float uViscosity;
  uniform float uBoundary;
  uniform float uBoundaryOffset;

  varying vec2 vUv;

  void main() {
    vec4 pos = texture2D(tPosition, vUv);
    vec4 oldPos = texture2D(tOldPosition, vUv);
    vec4 vel = texture2D(tVelocity, vUv);

    if (pos.w < 0.5) {
      gl_FragColor = vel;
      return;
    }

    // Calculate velocity from position change
    vec3 newVel = (pos.xyz - oldPos.xyz) / uDt;

    // Apply viscosity damping
    float vL = 1.0 - (uViscosity * uDt);
    newVel *= vL;

    // Boundary velocity reflection
    float minBound = -uBoundary + uBoundaryOffset;
    float maxBound = uBoundary - uBoundaryOffset;

    for (int a = 0; a < 3; a++) {
      float p = a == 0 ? pos.x : (a == 1 ? pos.y : pos.z);
      float v = a == 0 ? newVel.x : (a == 1 ? newVel.y : newVel.z);

      if (p <= minBound || p >= maxBound) {
        if (a == 0) newVel.x *= -0.2;
        else if (a == 1) newVel.y *= -0.2;
        else newVel.z *= -0.2;
      }
    }

    gl_FragColor = vec4(newVel, vel.w);
  }
`;

// Fragment shader: Copy old positions for velocity calculation
export const copyPositionShader = `
  precision highp float;

  uniform sampler2D tPosition;

  varying vec2 vUv;

  void main() {
    gl_FragColor = texture2D(tPosition, vUv);
  }
`;

// Fragment shader: Add new particles
export const addParticlesShader = `
  precision highp float;

  uniform sampler2D tPosition;
  uniform vec3 uOrigin;
  uniform float uSpacing;
  uniform int uStartIndex;
  uniform int uAddCount;
  uniform int uGridDim;
  uniform vec2 uParticleRes;
  uniform float uJitter;
  uniform float uSeed;

  varying vec2 vUv;

  // Simple hash for random jitter
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec4 pos = texture2D(tPosition, vUv);

    // Calculate particle index from UV
    int idx = int(floor(vUv.x * uParticleRes.x) + floor(vUv.y * uParticleRes.y) * uParticleRes.x);

    // Check if this particle should be added
    if (idx >= uStartIndex && idx < uStartIndex + uAddCount) {
      int localIdx = idx - uStartIndex;

      // Calculate grid position
      int gx = int(mod(float(localIdx), float(uGridDim)));
      int gy = int(mod(float(localIdx / uGridDim), float(uGridDim)));
      int gz = localIdx / (uGridDim * uGridDim);

      float offset = float(uGridDim - 1) * uSpacing * 0.5;

      // Random jitter
      vec2 jitterSeed = vUv + uSeed;
      float jx = (hash(jitterSeed) - 0.5) * uSpacing * uJitter;
      float jy = (hash(jitterSeed + vec2(1.0, 0.0)) - 0.5) * uSpacing * uJitter;
      float jz = (hash(jitterSeed + vec2(0.0, 1.0)) - 0.5) * uSpacing * uJitter;

      vec3 newPos = uOrigin + vec3(
        float(gx) * uSpacing - offset + jx,
        float(gy) * uSpacing - offset + jy,
        float(gz) * uSpacing - offset + jz
      );

      gl_FragColor = vec4(newPos, 1.0); // w=1 means active
    } else {
      gl_FragColor = pos;
    }
  }
`;

// Fragment shader: Initialize velocity for new particles
export const initVelocityShader = `
  precision highp float;

  uniform sampler2D tVelocity;
  uniform int uStartIndex;
  uniform int uAddCount;
  uniform vec2 uParticleRes;

  varying vec2 vUv;

  void main() {
    vec4 vel = texture2D(tVelocity, vUv);

    int idx = int(floor(vUv.x * uParticleRes.x) + floor(vUv.y * uParticleRes.y) * uParticleRes.x);

    if (idx >= uStartIndex && idx < uStartIndex + uAddCount) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Zero velocity, active
    } else {
      gl_FragColor = vel;
    }
  }
`;
