
import { FluidConfig } from '../types';

export class FluidEngine {
  public positions: Float32Array;
  public velocities: Float32Array;
  public densities: Float32Array;
  private oldPositions: Float32Array;

  public particleCount: number = 0;
  private maxParticles: number;
  private grid: Map<string, number[]>;

  // Base radius for spawning (set at init, used for spawn spacing)
  private baseRadius: number;

  constructor(config: FluidConfig) {
    this.maxParticles = config.maxParticles;
    this.positions = new Float32Array(this.maxParticles * 3).fill(10000);
    this.oldPositions = new Float32Array(this.maxParticles * 3).fill(10000);
    this.velocities = new Float32Array(this.maxParticles * 3);
    this.densities = new Float32Array(this.maxParticles);
    this.baseRadius = config.particleRadius;
    this.grid = new Map();
  }

  public getParticleSpacing(): number {
    return this.baseRadius * 2.2;
  }

  public addParticles(count: number, origin: [number, number, number]) {
    const start = this.particleCount;
    const end = Math.min(this.maxParticles, start + count);
    const spacing = this.getParticleSpacing();

    let added = 0;
    const gridDim = Math.ceil(Math.cbrt(count));
    const offset = (gridDim - 1) * spacing * 0.5;

    for (let x = 0; x < gridDim && added < (end - start); x++) {
      for (let y = 0; y < gridDim && added < (end - start); y++) {
        for (let z = 0; z < gridDim && added < (end - start); z++) {
          const i = start + added;
          const idx = i * 3;
          this.positions[idx] = origin[0] - offset + x * spacing + (Math.random() - 0.5) * spacing * 0.3;
          this.positions[idx + 1] = origin[1] - offset + y * spacing + (Math.random() - 0.5) * spacing * 0.3;
          this.positions[idx + 2] = origin[2] - offset + z * spacing + (Math.random() - 0.5) * spacing * 0.3;
          this.oldPositions.set(this.positions.subarray(idx, idx + 3), idx);
          added++;
        }
      }
    }
    this.particleCount = start + added;
  }

  private updateGrid(cellSize: number) {
    this.grid.clear();
    for (let i = 0; i < this.particleCount; i++) {
      const px = this.positions[i*3], py = this.positions[i*3+1], pz = this.positions[i*3+2];
      if (px > 5000) continue;
      const k = `${Math.floor(px/cellSize)},${Math.floor(py/cellSize)},${Math.floor(pz/cellSize)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k)!.push(i);
    }
  }

  public step(dt: number, config: FluidConfig, gravityVec: [number, number, number]) {
    if (this.particleCount === 0) return;

    // NEW DESIGN: Separate physics and visual radius
    // - particleRadius (from UI) = VISUAL particle size (what user sees/controls)
    // - smoothness = visual / physics ratio
    // - physicsRadius = visualRadius / smoothness
    const visualRadius = config.particleRadius;
    const smoothness = Math.max(1.0, config.visualRatio);
    const physicsRadius = visualRadius / smoothness;

    // SPH kernel radius - fixed value for stability
    const h = 1.7;
    const h2 = h * h;
    const poly6 = 315 / (64 * Math.PI * Math.pow(h, 9));
    const spikyGrad = -45 / (Math.PI * Math.pow(h, 6));

    // Rest density - use config value directly
    const effectiveRestDensity = config.restDensity;

    // Collision distance based on physics particle size
    const minDist = physicsRadius * 2.0;
    const cellSize = Math.max(h, minDist);

    const boundary = config.boundarySize / 2;
    const boundaryOffset = physicsRadius;
    const wallRepelDist = physicsRadius * 1.2;

    const sDt = dt;

    // Apply gravity and predict positions
    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 3;
      this.oldPositions.set(this.positions.subarray(idx, idx + 3), idx);
      this.velocities[idx] += gravityVec[0] * sDt;
      this.velocities[idx+1] += gravityVec[1] * sDt;
      this.velocities[idx+2] += gravityVec[2] * sDt;
      this.positions[idx] += this.velocities[idx] * sDt;
      this.positions[idx+1] += this.velocities[idx+1] * sDt;
      this.positions[idx+2] += this.velocities[idx+2] * sDt;
    }

    this.updateGrid(cellSize);

    // Multiple constraint iterations for stability
    const constraintIterations = 3;

    for (let iter = 0; iter < constraintIterations; iter++) {
      // Density calculation and pressure constraints
      for (let i = 0; i < this.particleCount; i++) {
        const idx = i * 3;
        const gx = Math.floor(this.positions[idx]/cellSize);
        const gy = Math.floor(this.positions[idx+1]/cellSize);
        const gz = Math.floor(this.positions[idx+2]/cellSize);
        let density = 0;
        const neighbors: number[] = [];

        // Search radius covers both SPH kernel and collision distance
        const searchRadius = Math.max(h2, minDist * minDist);

        for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++) {
          const cell = this.grid.get(`${gx+x},${gy+y},${gz+z}`);
          if (cell) for (const n of cell) {
            if (n === i) continue;
            const nIdx = n * 3;
            const dx = this.positions[idx]-this.positions[nIdx];
            const dy = this.positions[idx+1]-this.positions[nIdx+1];
            const dz = this.positions[idx+2]-this.positions[nIdx+2];
            const d2 = dx*dx + dy*dy + dz*dz;

            if (d2 < searchRadius) {
              neighbors.push(n);
              // SPH density (only within kernel radius)
              if (d2 < h2) {
                const w = h2 - d2;
                density += w*w*w * poly6;
              }
            }
          }
        }

        // Add self-contribution to density
        density += Math.pow(h2, 3) * poly6;
        this.densities[i] = density;

        // Stiffness controls how bouncy/springy the fluid is
        // Higher stiffness = more resistance to compression = bouncier
        const stiffnessNorm = config.stiffness / 2000.0;
        // Pressure calculation matches GPU: densityError * stiffness * 0.001
        const densityError = Math.max(0, density - effectiveRestDensity);
        const pressure = densityError * config.stiffness * 0.001;
        // Clamp pressure like GPU (maxPressure = restDensity * 0.5)
        const clampedPressure = Math.min(pressure, effectiveRestDensity * 0.5);

        for (const j of neighbors) {
          const jIdx = j * 3;
          const dx = this.positions[idx]-this.positions[jIdx];
          const dy = this.positions[idx+1]-this.positions[jIdx+1];
          const dz = this.positions[idx+2]-this.positions[jIdx+2];
          const d2 = dx*dx + dy*dy + dz*dz;
          const d = Math.sqrt(d2);

          if (d < 0.001) continue;

          const nx = dx/d, ny = dy/d, nz = dz/d;
          let mx = 0, my = 0, mz = 0;

          // SPH pressure force - matches GPU calculation
          if (d < h) {
            const kernelGrad = spikyGrad * Math.pow(h - d, 2);
            const force = clampedPressure * kernelGrad;
            mx += nx * force;
            my += ny * force;
            mz += nz * force;
          }

          // Soft collision - also affected by stiffness
          // Higher stiffness = stronger collision response
          if (d < minDist) {
            const overlap = (minDist - d);
            // Collision strength matches GPU: 0.5 + stiffnessNorm * 0.3
            const collisionStrength = 0.5 + stiffnessNorm * 0.3;
            mx += nx * overlap * collisionStrength;
            my += ny * overlap * collisionStrength;
            mz += nz * overlap * collisionStrength;
          }

          this.positions[idx] += mx;
          this.positions[idx+1] += my;
          this.positions[idx+2] += mz;
          this.positions[jIdx] -= mx;
          this.positions[jIdx+1] -= my;
          this.positions[jIdx+2] -= mz;
        }
      }
    }

    // Boundary constraints
    for (let i = 0; i < this.particleCount; i++) {
      const idx = i * 3;
      for (let a = 0; a < 3; a++) {
        const cur = idx + a;
        const minBound = -boundary + boundaryOffset;
        const maxBound = boundary - boundaryOffset;

        // Soft repulsion near walls
        const distToMin = this.positions[cur] - minBound;
        const distToMax = maxBound - this.positions[cur];
        if (distToMin < wallRepelDist) this.positions[cur] += 0.1 * (wallRepelDist - distToMin);
        if (distToMax < wallRepelDist) this.positions[cur] -= 0.1 * (wallRepelDist - distToMax);

        // Hard boundary
        if (this.positions[cur] < minBound) { this.positions[cur] = minBound; this.velocities[cur] *= -0.2; }
        else if (this.positions[cur] > maxBound) { this.positions[cur] = maxBound; this.velocities[cur] *= -0.2; }
      }

      // Update velocities from position change
      this.velocities[idx] = (this.positions[idx] - this.oldPositions[idx]) / sDt;
      this.velocities[idx+1] = (this.positions[idx+1] - this.oldPositions[idx+1]) / sDt;
      this.velocities[idx+2] = (this.positions[idx+2] - this.oldPositions[idx+2]) / sDt;

      // Viscosity damping
      const vL = 1.0 - (config.viscosity * sDt);
      this.velocities[idx] *= vL;
      this.velocities[idx+1] *= vL;
      this.velocities[idx+2] *= vL;
    }
  }

  public reset() { this.particleCount = 0; this.positions.fill(10000); this.grid.clear(); }
}
