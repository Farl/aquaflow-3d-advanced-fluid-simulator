
import * as THREE from 'three';
import { FluidConfig } from '../types';
import {
  computeVertexShader,
  integrateShader,
  velocityIntegrateShader,
  createDensityShader,
  createForceShader,
  applyForcesShader,
  boundaryShader,
  velocityUpdateShader,
  copyPositionShader,
  addParticlesShader,
  initVelocityShader
} from '../shaders/physicsShaders';

// GPGPU Compute Target helper
class GPUComputeTarget {
  public renderTarget1: THREE.WebGLRenderTarget;
  public renderTarget2: THREE.WebGLRenderTarget;
  private current: number = 0;

  constructor(width: number, height: number) {
    const options: THREE.RenderTargetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false
    };

    this.renderTarget1 = new THREE.WebGLRenderTarget(width, height, options);
    this.renderTarget2 = new THREE.WebGLRenderTarget(width, height, options);
  }

  get read(): THREE.WebGLRenderTarget {
    return this.current === 0 ? this.renderTarget1 : this.renderTarget2;
  }

  get write(): THREE.WebGLRenderTarget {
    return this.current === 0 ? this.renderTarget2 : this.renderTarget1;
  }

  swap(): void {
    this.current = 1 - this.current;
  }

  dispose(): void {
    this.renderTarget1.dispose();
    this.renderTarget2.dispose();
  }
}

export class GPUFluidEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh;

  // Particle data textures (ping-pong buffers)
  private positionTarget: GPUComputeTarget;
  private velocityTarget: GPUComputeTarget;
  private oldPositionTarget: GPUComputeTarget;
  private densityTarget: THREE.WebGLRenderTarget;
  private forceTarget: THREE.WebGLRenderTarget;

  // Shader materials
  private integrateMaterial: THREE.ShaderMaterial;
  private velocityIntegrateMaterial: THREE.ShaderMaterial;
  private densityMaterial: THREE.ShaderMaterial;
  private forceMaterial: THREE.ShaderMaterial;
  private applyForcesMaterial: THREE.ShaderMaterial;
  private boundaryMaterial: THREE.ShaderMaterial;
  private velocityUpdateMaterial: THREE.ShaderMaterial;
  private copyMaterial: THREE.ShaderMaterial;
  private addParticlesMaterial: THREE.ShaderMaterial;
  private initVelocityMaterial: THREE.ShaderMaterial;

  // Particle management
  public particleCount: number = 0;
  private maxParticles: number;
  public textureSize: number;
  private baseRadius: number;

  constructor(config: FluidConfig, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.maxParticles = config.maxParticles;
    this.baseRadius = config.particleRadius;

    // Calculate texture size (square texture to hold all particles)
    this.textureSize = Math.ceil(Math.sqrt(this.maxParticles));

    // Create scene and camera for compute passes
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Create fullscreen quad for compute passes
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(quadGeometry);
    this.scene.add(this.quad);

    // Create render targets
    const size = this.textureSize;
    this.positionTarget = new GPUComputeTarget(size, size);
    this.velocityTarget = new GPUComputeTarget(size, size);
    this.oldPositionTarget = new GPUComputeTarget(size, size);

    const rtOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false
    };
    this.densityTarget = new THREE.WebGLRenderTarget(size, size, rtOptions);
    this.forceTarget = new THREE.WebGLRenderTarget(size, size, rtOptions);

    // Initialize textures with inactive particles (w=0)
    this.initializeTextures();

    // Create shader materials
    this.integrateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        tVelocity: { value: null },
        uGravity: { value: new THREE.Vector3(0, -9.8, 0) },
        uDt: { value: 0.016 },
        uResolution: { value: new THREE.Vector2(size, size) }
      },
      vertexShader: computeVertexShader,
      fragmentShader: integrateShader
    });

    this.velocityIntegrateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tVelocity: { value: null },
        uGravity: { value: new THREE.Vector3(0, -9.8, 0) },
        uDt: { value: 0.016 }
      },
      vertexShader: computeVertexShader,
      fragmentShader: velocityIntegrateShader
    });

    // Density shader with reasonable max neighbors
    this.densityMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        tVelocity: { value: null },
        uKernelRadius: { value: 1.7 },
        uRestDensity: { value: config.restDensity },
        uParticleRes: { value: new THREE.Vector2(size, size) },
        uParticleCount: { value: 0 }
      },
      vertexShader: computeVertexShader,
      fragmentShader: createDensityShader(64)
    });

    // Force shader
    this.forceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        tVelocity: { value: null },
        tDensity: { value: null },
        uKernelRadius: { value: 1.7 },
        uStiffness: { value: config.stiffness },
        uRestDensity: { value: config.restDensity },
        uMinDist: { value: config.particleRadius * 2.0 * 0.4 },
        uCollisionStrength: { value: 0.45 },
        uSurfaceTension: { value: config.surfaceTension ?? 0.5 },
        uParticleRes: { value: new THREE.Vector2(size, size) },
        uParticleCount: { value: 0 }
      },
      vertexShader: computeVertexShader,
      fragmentShader: createForceShader(64)
    });

    this.applyForcesMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        tForce: { value: null }
      },
      vertexShader: computeVertexShader,
      fragmentShader: applyForcesShader
    });

    this.boundaryMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        tVelocity: { value: null },
        uBoundary: { value: config.boundarySize / 2 },
        uBoundaryOffset: { value: config.particleRadius * 0.4 },
        uWallRepelDist: { value: config.particleRadius * 1.2 }
      },
      vertexShader: computeVertexShader,
      fragmentShader: boundaryShader
    });

    this.velocityUpdateMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        tOldPosition: { value: null },
        tVelocity: { value: null },
        uDt: { value: 0.016 },
        uViscosity: { value: config.viscosity },
        uBoundary: { value: config.boundarySize / 2 },
        uBoundaryOffset: { value: config.particleRadius * 0.4 }
      },
      vertexShader: computeVertexShader,
      fragmentShader: velocityUpdateShader
    });

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null }
      },
      vertexShader: computeVertexShader,
      fragmentShader: copyPositionShader
    });

    this.addParticlesMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPosition: { value: null },
        uOrigin: { value: new THREE.Vector3(0, 0, 0) },
        uSpacing: { value: this.getParticleSpacing() },
        uStartIndex: { value: 0 },
        uAddCount: { value: 0 },
        uGridDim: { value: 1 },
        uParticleRes: { value: new THREE.Vector2(size, size) },
        uJitter: { value: 0.3 },
        uSeed: { value: 0 }
      },
      vertexShader: computeVertexShader,
      fragmentShader: addParticlesShader
    });

    this.initVelocityMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tVelocity: { value: null },
        uStartIndex: { value: 0 },
        uAddCount: { value: 0 },
        uParticleRes: { value: new THREE.Vector2(size, size) }
      },
      vertexShader: computeVertexShader,
      fragmentShader: initVelocityShader
    });
  }

  private initializeTextures(): void {
    const size = this.textureSize;
    const data = new Float32Array(size * size * 4);

    // Initialize with inactive particles (w=0, position far away)
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = 10000;     // x
      data[i * 4 + 1] = 10000; // y
      data[i * 4 + 2] = 10000; // z
      data[i * 4 + 3] = 0;     // w = 0 means inactive
    }

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;

    // Initialize position targets
    this.renderToTarget(texture, this.positionTarget.renderTarget1);
    this.renderToTarget(texture, this.positionTarget.renderTarget2);
    this.renderToTarget(texture, this.oldPositionTarget.renderTarget1);
    this.renderToTarget(texture, this.oldPositionTarget.renderTarget2);

    // Initialize velocity targets with zero velocity
    const velData = new Float32Array(size * size * 4).fill(0);
    const velTexture = new THREE.DataTexture(velData, size, size, THREE.RGBAFormat, THREE.FloatType);
    velTexture.needsUpdate = true;

    this.renderToTarget(velTexture, this.velocityTarget.renderTarget1);
    this.renderToTarget(velTexture, this.velocityTarget.renderTarget2);

    texture.dispose();
    velTexture.dispose();
  }

  private renderToTarget(texture: THREE.Texture, target: THREE.WebGLRenderTarget): void {
    const copyMat = new THREE.ShaderMaterial({
      uniforms: { tPosition: { value: texture } },
      vertexShader: computeVertexShader,
      fragmentShader: copyPositionShader
    });

    this.quad.material = copyMat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    copyMat.dispose();
  }

  public getParticleSpacing(): number {
    return this.baseRadius * 2.2;
  }

  public addParticles(count: number, origin: [number, number, number]): void {
    const start = this.particleCount;
    const end = Math.min(this.maxParticles, start + count);
    const actualCount = end - start;

    if (actualCount <= 0) return;

    const gridDim = Math.ceil(Math.cbrt(actualCount));

    // Update position texture with new particles
    this.addParticlesMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
    this.addParticlesMaterial.uniforms.uOrigin.value.set(origin[0], origin[1], origin[2]);
    this.addParticlesMaterial.uniforms.uSpacing.value = this.getParticleSpacing();
    this.addParticlesMaterial.uniforms.uStartIndex.value = start;
    this.addParticlesMaterial.uniforms.uAddCount.value = actualCount;
    this.addParticlesMaterial.uniforms.uGridDim.value = gridDim;
    this.addParticlesMaterial.uniforms.uSeed.value = Math.random() * 1000;

    this.quad.material = this.addParticlesMaterial;
    this.renderer.setRenderTarget(this.positionTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.positionTarget.swap();

    // Also update old position
    this.copyMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
    this.quad.material = this.copyMaterial;
    this.renderer.setRenderTarget(this.oldPositionTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.oldPositionTarget.swap();

    // Initialize velocities for new particles
    this.initVelocityMaterial.uniforms.tVelocity.value = this.velocityTarget.read.texture;
    this.initVelocityMaterial.uniforms.uStartIndex.value = start;
    this.initVelocityMaterial.uniforms.uAddCount.value = actualCount;

    this.quad.material = this.initVelocityMaterial;
    this.renderer.setRenderTarget(this.velocityTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.velocityTarget.swap();

    this.renderer.setRenderTarget(null);

    this.particleCount = end;
  }

  public step(dt: number, config: FluidConfig, gravityVec: [number, number, number]): void {
    if (this.particleCount === 0) return;

    const h = 1.7; // Fixed kernel radius
    const smoothness = config.visualRatio;
    const minDist = config.particleRadius * 2.0 * (1.4 - smoothness);
    const boundary = config.boundarySize / 2;
    const boundaryOffset = config.particleRadius * (1.4 - smoothness);
    const stiffnessNorm = config.stiffness / 2000.0;
    const collisionStrength = 0.3 + stiffnessNorm * 0.15;

    // Save current render target
    const prevTarget = this.renderer.getRenderTarget();

    // Step 1: Copy positions to old positions
    this.copyMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
    this.quad.material = this.copyMaterial;
    this.renderer.setRenderTarget(this.oldPositionTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.oldPositionTarget.swap();

    // Step 2: Apply gravity and integrate velocities
    this.velocityIntegrateMaterial.uniforms.tVelocity.value = this.velocityTarget.read.texture;
    this.velocityIntegrateMaterial.uniforms.uGravity.value.set(gravityVec[0], gravityVec[1], gravityVec[2]);
    this.velocityIntegrateMaterial.uniforms.uDt.value = dt;

    this.quad.material = this.velocityIntegrateMaterial;
    this.renderer.setRenderTarget(this.velocityTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.velocityTarget.swap();

    // Step 3: Integrate positions
    this.integrateMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
    this.integrateMaterial.uniforms.tVelocity.value = this.velocityTarget.read.texture;
    this.integrateMaterial.uniforms.uGravity.value.set(gravityVec[0], gravityVec[1], gravityVec[2]);
    this.integrateMaterial.uniforms.uDt.value = dt;

    this.quad.material = this.integrateMaterial;
    this.renderer.setRenderTarget(this.positionTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.positionTarget.swap();

    // Constraint iterations
    const constraintIterations = 3;
    for (let iter = 0; iter < constraintIterations; iter++) {
      // Step 4: Compute density
      this.densityMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
      this.densityMaterial.uniforms.tVelocity.value = this.velocityTarget.read.texture;
      this.densityMaterial.uniforms.uKernelRadius.value = h;
      this.densityMaterial.uniforms.uRestDensity.value = config.restDensity;
      this.densityMaterial.uniforms.uParticleCount.value = this.particleCount;

      this.quad.material = this.densityMaterial;
      this.renderer.setRenderTarget(this.densityTarget);
      this.renderer.render(this.scene, this.camera);

      // Step 5: Compute forces
      this.forceMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
      this.forceMaterial.uniforms.tVelocity.value = this.velocityTarget.read.texture;
      this.forceMaterial.uniforms.tDensity.value = this.densityTarget.texture;
      this.forceMaterial.uniforms.uKernelRadius.value = h;
      this.forceMaterial.uniforms.uStiffness.value = config.stiffness;
      this.forceMaterial.uniforms.uRestDensity.value = config.restDensity;
      this.forceMaterial.uniforms.uMinDist.value = minDist;
      this.forceMaterial.uniforms.uCollisionStrength.value = collisionStrength;
      this.forceMaterial.uniforms.uSurfaceTension.value = config.surfaceTension ?? 0.5;
      this.forceMaterial.uniforms.uParticleCount.value = this.particleCount;

      this.quad.material = this.forceMaterial;
      this.renderer.setRenderTarget(this.forceTarget);
      this.renderer.render(this.scene, this.camera);

      // Step 6: Apply forces
      this.applyForcesMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
      this.applyForcesMaterial.uniforms.tForce.value = this.forceTarget.texture;

      this.quad.material = this.applyForcesMaterial;
      this.renderer.setRenderTarget(this.positionTarget.write);
      this.renderer.render(this.scene, this.camera);
      this.positionTarget.swap();
    }

    // Step 7: Apply boundary constraints
    this.boundaryMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
    this.boundaryMaterial.uniforms.tVelocity.value = this.velocityTarget.read.texture;
    this.boundaryMaterial.uniforms.uBoundary.value = boundary;
    this.boundaryMaterial.uniforms.uBoundaryOffset.value = boundaryOffset;
    this.boundaryMaterial.uniforms.uWallRepelDist.value = config.particleRadius * 1.2;

    this.quad.material = this.boundaryMaterial;
    this.renderer.setRenderTarget(this.positionTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.positionTarget.swap();

    // Step 8: Update velocities from position change
    this.velocityUpdateMaterial.uniforms.tPosition.value = this.positionTarget.read.texture;
    this.velocityUpdateMaterial.uniforms.tOldPosition.value = this.oldPositionTarget.read.texture;
    this.velocityUpdateMaterial.uniforms.tVelocity.value = this.velocityTarget.read.texture;
    this.velocityUpdateMaterial.uniforms.uDt.value = dt;
    this.velocityUpdateMaterial.uniforms.uViscosity.value = config.viscosity;
    this.velocityUpdateMaterial.uniforms.uBoundary.value = boundary;
    this.velocityUpdateMaterial.uniforms.uBoundaryOffset.value = boundaryOffset;

    this.quad.material = this.velocityUpdateMaterial;
    this.renderer.setRenderTarget(this.velocityTarget.write);
    this.renderer.render(this.scene, this.camera);
    this.velocityTarget.swap();

    // Restore render target
    this.renderer.setRenderTarget(prevTarget);
    // No CPU readback needed - particles render directly from GPU texture
  }

  public getPositionTexture(): THREE.Texture {
    return this.positionTarget.read.texture;
  }

  public reset(): void {
    this.particleCount = 0;
    this.initializeTextures();
  }

  public dispose(): void {
    this.positionTarget.dispose();
    this.velocityTarget.dispose();
    this.oldPositionTarget.dispose();
    this.densityTarget.dispose();
    this.forceTarget.dispose();

    this.integrateMaterial.dispose();
    this.velocityIntegrateMaterial.dispose();
    this.densityMaterial.dispose();
    this.forceMaterial.dispose();
    this.applyForcesMaterial.dispose();
    this.boundaryMaterial.dispose();
    this.velocityUpdateMaterial.dispose();
    this.copyMaterial.dispose();
    this.addParticlesMaterial.dispose();
    this.initVelocityMaterial.dispose();

    (this.quad.geometry as THREE.BufferGeometry).dispose();
  }
}
