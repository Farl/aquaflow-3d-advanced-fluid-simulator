
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GPUFluidEngine } from '../services/GPUFluidEngine';
import { FluidConfig } from '../types';
import {
  depthVertexShaderGPU,
  createDepthFragmentShader,
  blurVertexShader,
  createBlurFragmentShader,
  thicknessVertexShaderGPU,
  createThicknessFragmentShader,
  dotVertexShaderGPU,
  dotFragmentShaderGPU,
  finalVertexShader,
  createFinalFragmentShader,
  FinalShaderParams
} from '../shaders/fluidShaders';

interface Props {
  config: FluidConfig;
  onStatsUpdate: (count: number) => void;
  triggerInject: number;
  resetRotation: number;
}

const FluidSimulator: React.FC<Props> = ({ config, onStatsUpdate, triggerInject, resetRotation }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GPUFluidEngine | null>(null);
  const configRef = useRef<FluidConfig>(config);

  // Mouse drag state with inertia
  const dragState = useRef({
    isDown: false,
    lastX: 0,
    lastY: 0,
    velocityX: 0,
    velocityY: 0
  });

  const resourcesRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    depthRT: THREE.WebGLRenderTarget;
    blurRT1: THREE.WebGLRenderTarget;
    blurRT2: THREE.WebGLRenderTarget;
    thicknessRT: THREE.WebGLRenderTarget;
    refractionRT: THREE.WebGLRenderTarget;
    particlesDepth: THREE.Points;
    particlesThickness: THREE.Points;
    particlesDots: THREE.Points;
    container: THREE.Mesh;
    helper: THREE.BoxHelper;
    quadCamera: THREE.OrthographicCamera;
    quadScene: THREE.Scene;
    quadMesh: THREE.Mesh;
    blurMaterial: THREE.ShaderMaterial;
    finalMaterial: THREE.ShaderMaterial;
    depthMaterial: THREE.ShaderMaterial;
    thicknessMaterial: THREE.ShaderMaterial;
    dotMaterial: THREE.ShaderMaterial;
    particleGeometry: THREE.BufferGeometry;
    envTexture: THREE.Texture | null;
    currentRenderScale: number;
    currentBlurRadius: number;
    currentBlurDepthFalloff: number;
    currentShaderParams: FinalShaderParams & { depthZOffset: number; thicknessIntensity: number };
    baseWidth: number;
    baseHeight: number;
  } | null>(null);

  useEffect(() => { configRef.current = config; }, [config]);

  useEffect(() => {
    if (!containerRef.current) return;

    while (containerRef.current.firstChild) {
      containerRef.current.removeChild(containerRef.current.firstChild);
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.autoClear = false;
    // Use ACES tone mapping for dot mode (scene rendering)
    // Liquid mode handles tone mapping in the shader
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    containerRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);

    const textureLoader = new THREE.TextureLoader();
    const basePath = import.meta.env.BASE_URL || '/';
    textureLoader.load(
      `${basePath}DayEnvironmentHDRI057_1K/DayEnvironmentHDRI057_1K_TONEMAPPED.jpg`,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
        scene.environment = texture;
        if (resourcesRef.current) {
          resourcesRef.current.envTexture = texture;
          // Update final material with environment texture for reflections
          resourcesRef.current.finalMaterial.uniforms.tEnvMap.value = texture;
          resourcesRef.current.finalMaterial.uniforms.uHasEnvMap.value = 1.0;
        }
      },
      undefined,
      (error) => { console.warn('Failed to load HDRI:', error); }
    );

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 22);
    camera.lookAt(0, 0, 0);

    const engine = new GPUFluidEngine(configRef.current, renderer);
    engineRef.current = engine;
    engine.addParticles(300, [0, 3, 0]);

    const renderScale = configRef.current.renderScale;
    const rtWidth = Math.floor(width * renderScale);
    const rtHeight = Math.floor(height * renderScale);
    const rtOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType };
    const depthRT = new THREE.WebGLRenderTarget(rtWidth, rtHeight, rtOptions);
    const blurRT1 = new THREE.WebGLRenderTarget(rtWidth, rtHeight, rtOptions);
    const blurRT2 = new THREE.WebGLRenderTarget(rtWidth, rtHeight, rtOptions);
    const thicknessRT = new THREE.WebGLRenderTarget(rtWidth, rtHeight, rtOptions);
    const refractionRT = new THREE.WebGLRenderTarget(rtWidth, rtHeight, rtOptions);

    // Create elegant glass container with mesh faces
    const boundSize = configRef.current.boundarySize;
    const containerGroup = new THREE.Group();

    // Glass material for container faces
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.08,
      roughness: 0.05,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 0.3,
      depthWrite: false
    });

    // Create 6 faces as separate planes for better glass effect
    const faceGeo = new THREE.PlaneGeometry(1, 1);
    const faces = [
      { pos: [0, 0, 0.5], rot: [0, 0, 0] },       // front
      { pos: [0, 0, -0.5], rot: [0, Math.PI, 0] }, // back
      { pos: [0.5, 0, 0], rot: [0, Math.PI/2, 0] }, // right
      { pos: [-0.5, 0, 0], rot: [0, -Math.PI/2, 0] }, // left
      { pos: [0, 0.5, 0], rot: [-Math.PI/2, 0, 0] }, // top
      { pos: [0, -0.5, 0], rot: [Math.PI/2, 0, 0] }  // bottom
    ];

    faces.forEach(f => {
      const face = new THREE.Mesh(faceGeo, glassMaterial);
      face.position.set(f.pos[0] * boundSize, f.pos[1] * boundSize, f.pos[2] * boundSize);
      face.rotation.set(f.rot[0], f.rot[1], f.rot[2]);
      face.scale.setScalar(boundSize);
      containerGroup.add(face);
    });

    scene.add(containerGroup);
    const container = containerGroup;
    const helper = containerGroup; // Keep reference for compatibility

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dLight.position.set(10, 20, 20);
    scene.add(dLight);

    const particleGeometry = new THREE.BufferGeometry();
    const maxPart = configRef.current.maxParticles;
    // Use particle index attribute for GPU texture lookup (no CPU position updates needed)
    const particleIndices = new Float32Array(maxPart);
    for (let i = 0; i < maxPart; i++) particleIndices[i] = i;
    particleGeometry.setAttribute('particleIndex', new THREE.BufferAttribute(particleIndices, 1));
    // Dummy position attribute (required by THREE.js but not used in GPU shaders)
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPart * 3), 3));
    particleGeometry.setDrawRange(0, 0);

    // Get texture size from engine for GPU shader uniforms
    const textureSize = Math.ceil(Math.sqrt(maxPart));
    const particleRes = new THREE.Vector2(textureSize, textureSize);

    // Visual radius is fixed at particleRadius (smoothness only affects physics)
    const visualRadius = configRef.current.particleRadius;

    // Validate shader parameters to prevent invalid values
    const validateShaderParams = (params: FinalShaderParams & { depthZOffset: number; thicknessIntensity: number }) => ({
      ...params,
      fresnelPower: Math.max(0.001, params.fresnelPower),
      fresnelBias: Math.max(-1.0, Math.min(1.0, params.fresnelBias)),
      ior: Math.max(1.0, Math.min(3.0, params.ior)),
      specularPower: Math.max(1.0, params.specularPower),
      absorptionDensity: Math.max(0, params.absorptionDensity),
    });

    // Get initial shader parameters from config
    const initialShaderParams = validateShaderParams({
      ior: configRef.current.ior ?? 1.33,
      refractionStrength: configRef.current.refractionStrength ?? 0.05,
      fresnelPower: configRef.current.fresnelPower ?? 0.4,
      fresnelIntensity: configRef.current.fresnelIntensity ?? 0.02,
      fresnelBias: configRef.current.fresnelBias ?? 0.0,
      specularPower: configRef.current.specularPower ?? 32.0,
      specularIntensity: configRef.current.specularIntensity ?? 0.25,
      edgeSampleRadius: configRef.current.edgeSampleRadius ?? 2.0,
      edgeSmoothness: configRef.current.edgeSmoothness ?? 5.0,
      absorptionDensity: configRef.current.absorptionDensity ?? 0,
      waterTintR: configRef.current.waterTintR ?? 0.98,
      waterTintG: configRef.current.waterTintG ?? 0.99,
      waterTintB: configRef.current.waterTintB ?? 1.0,
      depthZOffset: configRef.current.depthZOffset ?? 0.45,
      thicknessIntensity: configRef.current.thicknessIntensity ?? 0.05,
      reflectionIntensity: configRef.current.reflectionIntensity ?? 1.0
    });

    const depthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uProj: { value: camera.projectionMatrix },
        uScale: { value: renderScale },
        uRadius: { value: visualRadius },
        tPosition: { value: null },
        uParticleRes: { value: particleRes },
        uParticleCount: { value: 0 }
      },
      vertexShader: depthVertexShaderGPU,
      fragmentShader: createDepthFragmentShader(initialShaderParams.depthZOffset)
    });

    const blurRadius = configRef.current.blurRadius || 15;
    const blurDepthFalloff = configRef.current.blurDepthFalloff || 30;
    const blurMaterial = new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uTexSize: { value: new THREE.Vector2(1/rtWidth, 1/rtHeight) }, uDir: { value: new THREE.Vector2(1, 0) } },
      vertexShader: blurVertexShader,
      fragmentShader: createBlurFragmentShader(blurRadius, blurDepthFalloff)
    });

    const thicknessMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: renderScale },
        uRadius: { value: configRef.current.particleRadius },
        tPosition: { value: null },
        uParticleRes: { value: particleRes },
        uParticleCount: { value: 0 }
      },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: thicknessVertexShaderGPU,
      fragmentShader: createThicknessFragmentShader(initialShaderParams.thicknessIntensity)
    });

    const finalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: blurRT2.texture }, tThickness: { value: thicknessRT.texture }, tRefraction: { value: refractionRT.texture },
        tEnvMap: { value: null }, uHasEnvMap: { value: 0.0 },
        uInvProj: { value: camera.projectionMatrixInverse }, uViewMatrixInverse: { value: camera.matrixWorld },
        uRes: { value: new THREE.Vector2(rtWidth, rtHeight) },
        uExposure: { value: 1.2 }
      },
      vertexShader: finalVertexShader,
      fragmentShader: createFinalFragmentShader(initialShaderParams)
    });

    const quadScene = new THREE.Scene();
    const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial);
    quadScene.add(quadMesh);
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const particlesDepth = new THREE.Points(particleGeometry, depthMaterial);
    const particlesThickness = new THREE.Points(particleGeometry, thicknessMaterial);

    // GPU texture-based dot material for dot rendering mode
    const dotMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: 0.8 },
        uColor: { value: new THREE.Vector3(0.376, 0.647, 0.980) }, // 0x60a5fa
        uOpacity: { value: 0.9 },
        tPosition: { value: null },
        uParticleRes: { value: particleRes },
        uParticleCount: { value: 0 }
      },
      vertexShader: dotVertexShaderGPU,
      fragmentShader: dotFragmentShaderGPU,
      transparent: true,
      depthWrite: false
    });
    const particlesDots = new THREE.Points(particleGeometry, dotMaterial);

    resourcesRef.current = {
      renderer, scene, camera, depthRT, blurRT1, blurRT2, thicknessRT, refractionRT,
      particlesDepth, particlesThickness, particlesDots, container, helper, quadCamera, quadScene, quadMesh, blurMaterial, finalMaterial, depthMaterial, thicknessMaterial, dotMaterial, particleGeometry,
      envTexture: null,
      currentRenderScale: renderScale,
      currentBlurRadius: blurRadius,
      currentBlurDepthFalloff: blurDepthFalloff,
      currentShaderParams: initialShaderParams,
      baseWidth: width,
      baseHeight: height
    };

    // Mouse drag handlers with inertia
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, input, [data-ui-panel]') || !containerRef.current?.contains(target)) {
        return;
      }
      dragState.current.isDown = true;
      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current.isDown) return;
      const dx = e.clientX - dragState.current.lastX;
      const dy = e.clientY - dragState.current.lastY;
      // Set velocity from drag movement
      dragState.current.velocityX = dx * 0.005;
      dragState.current.velocityY = dy * 0.005;
      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
    };

    const onMouseUp = () => {
      dragState.current.isDown = false;
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    let animationId: number;
    let isRunning = true;

    const animate = () => {
      if (!isRunning) return;

      try {
        if (!resourcesRef.current || !engineRef.current) {
          animationId = requestAnimationFrame(animate);
          return;
        }
        const { renderer, scene, camera, depthRT, blurRT1, blurRT2, thicknessRT, refractionRT, particlesDepth, particlesThickness, particlesDots, container, helper, quadScene, quadCamera, quadMesh, blurMaterial, finalMaterial, depthMaterial, thicknessMaterial, particleGeometry } = resourcesRef.current;
        const cfg = configRef.current;
        const dt = 0.016;

        // Apply continuous rotation from config speeds
        scene.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), cfg.rotationX * dt);
        scene.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), cfg.rotationY * dt);
        scene.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), cfg.rotationZ * dt);

        // Apply drag velocity with inertia
        if (!dragState.current.isDown) {
          // Apply friction when not dragging
          dragState.current.velocityX *= 0.95;
          dragState.current.velocityY *= 0.95;
        }
        // Always apply the current velocity
        scene.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dragState.current.velocityX);
        scene.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), dragState.current.velocityY);

        // Update render targets if renderScale changed
        if (cfg.renderScale !== resourcesRef.current.currentRenderScale) {
          const newWidth = Math.floor(resourcesRef.current.baseWidth * cfg.renderScale);
          const newHeight = Math.floor(resourcesRef.current.baseHeight * cfg.renderScale);
          depthRT.setSize(newWidth, newHeight);
          blurRT1.setSize(newWidth, newHeight);
          blurRT2.setSize(newWidth, newHeight);
          thicknessRT.setSize(newWidth, newHeight);
          refractionRT.setSize(newWidth, newHeight);
          blurMaterial.uniforms.uTexSize.value.set(1/newWidth, 1/newHeight);
          finalMaterial.uniforms.uRes.value.set(newWidth, newHeight);
          depthMaterial.uniforms.uScale.value = cfg.renderScale;
          thicknessMaterial.uniforms.uScale.value = cfg.renderScale;
          resourcesRef.current.currentRenderScale = cfg.renderScale;
        }

        // Update blur shader if parameters changed
        const newBlurRadius = cfg.blurRadius || 15;
        const newBlurDepthFalloff = cfg.blurDepthFalloff || 30;
        if (newBlurRadius !== resourcesRef.current.currentBlurRadius ||
            newBlurDepthFalloff !== resourcesRef.current.currentBlurDepthFalloff) {
          // Recreate blur shader with new parameters
          const newBlurMaterial = new THREE.ShaderMaterial({
            uniforms: { tDepth: { value: null }, uTexSize: { value: blurMaterial.uniforms.uTexSize.value.clone() }, uDir: { value: new THREE.Vector2(1, 0) } },
            vertexShader: blurVertexShader,
            fragmentShader: createBlurFragmentShader(newBlurRadius, newBlurDepthFalloff)
          });
          resourcesRef.current.blurMaterial = newBlurMaterial;
          resourcesRef.current.currentBlurRadius = newBlurRadius;
          resourcesRef.current.currentBlurDepthFalloff = newBlurDepthFalloff;
        }

        // Check if advanced shader parameters changed
        const currentParams = resourcesRef.current.currentShaderParams;
        const newParams = validateShaderParams({
          ior: cfg.ior ?? 1.33,
          refractionStrength: cfg.refractionStrength ?? 0.05,
          fresnelPower: cfg.fresnelPower ?? 0.4,
          fresnelIntensity: cfg.fresnelIntensity ?? 0.02,
          fresnelBias: cfg.fresnelBias ?? 0.0,
          specularPower: cfg.specularPower ?? 32.0,
          specularIntensity: cfg.specularIntensity ?? 0.25,
          edgeSampleRadius: cfg.edgeSampleRadius ?? 2.0,
          edgeSmoothness: cfg.edgeSmoothness ?? 5.0,
          absorptionDensity: cfg.absorptionDensity ?? 0,
          waterTintR: cfg.waterTintR ?? 0.98,
          waterTintG: cfg.waterTintG ?? 0.99,
          waterTintB: cfg.waterTintB ?? 1.0,
          depthZOffset: cfg.depthZOffset ?? 0.45,
          thicknessIntensity: cfg.thicknessIntensity ?? 0.05,
          reflectionIntensity: cfg.reflectionIntensity ?? 1.0
        });

        // Check if depth shader needs update
        if (newParams.depthZOffset !== currentParams.depthZOffset) {
          const textureSize = Math.ceil(Math.sqrt(cfg.maxParticles));
          const newDepthMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uProj: { value: camera.projectionMatrix },
              uScale: { value: cfg.renderScale },
              uRadius: { value: cfg.particleRadius },
              tPosition: { value: engineRef.current?.getPositionTexture() || null },
              uParticleRes: { value: new THREE.Vector2(textureSize, textureSize) },
              uParticleCount: { value: engineRef.current?.particleCount || 0 }
            },
            vertexShader: depthVertexShaderGPU,
            fragmentShader: createDepthFragmentShader(newParams.depthZOffset)
          });
          resourcesRef.current.depthMaterial = newDepthMaterial;
          particlesDepth.material = newDepthMaterial;
        }

        // Check if thickness shader needs update
        if (newParams.thicknessIntensity !== currentParams.thicknessIntensity) {
          const textureSize = Math.ceil(Math.sqrt(cfg.maxParticles));
          const newThicknessMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uScale: { value: cfg.renderScale },
              uRadius: { value: cfg.particleRadius },
              tPosition: { value: engineRef.current?.getPositionTexture() || null },
              uParticleRes: { value: new THREE.Vector2(textureSize, textureSize) },
              uParticleCount: { value: engineRef.current?.particleCount || 0 }
            },
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
            vertexShader: thicknessVertexShaderGPU,
            fragmentShader: createThicknessFragmentShader(newParams.thicknessIntensity)
          });
          resourcesRef.current.thicknessMaterial = newThicknessMaterial;
          particlesThickness.material = newThicknessMaterial;
        }

        // Check if final shader needs update (any of the FinalShaderParams changed)
        const finalParamsChanged =
          newParams.ior !== currentParams.ior ||
          newParams.refractionStrength !== currentParams.refractionStrength ||
          newParams.fresnelPower !== currentParams.fresnelPower ||
          newParams.fresnelIntensity !== currentParams.fresnelIntensity ||
          newParams.fresnelBias !== currentParams.fresnelBias ||
          newParams.specularPower !== currentParams.specularPower ||
          newParams.specularIntensity !== currentParams.specularIntensity ||
          newParams.edgeSampleRadius !== currentParams.edgeSampleRadius ||
          newParams.edgeSmoothness !== currentParams.edgeSmoothness ||
          newParams.absorptionDensity !== currentParams.absorptionDensity ||
          newParams.waterTintR !== currentParams.waterTintR ||
          newParams.waterTintG !== currentParams.waterTintG ||
          newParams.waterTintB !== currentParams.waterTintB ||
          newParams.reflectionIntensity !== currentParams.reflectionIntensity;

        if (finalParamsChanged) {
          const newFinalMaterial = new THREE.ShaderMaterial({
            uniforms: {
              tDepth: { value: blurRT2.texture }, tThickness: { value: thicknessRT.texture }, tRefraction: { value: refractionRT.texture },
              tEnvMap: { value: resourcesRef.current.envTexture }, uHasEnvMap: { value: resourcesRef.current.envTexture ? 1.0 : 0.0 },
              uInvProj: { value: camera.projectionMatrixInverse }, uViewMatrixInverse: { value: camera.matrixWorld },
              uRes: { value: finalMaterial.uniforms.uRes.value.clone() },
              uExposure: { value: 1.2 }
            },
            vertexShader: finalVertexShader,
            fragmentShader: createFinalFragmentShader(newParams)
          });
          resourcesRef.current.finalMaterial = newFinalMaterial;
        }

        // Update tracked parameters
        resourcesRef.current.currentShaderParams = newParams;

        // Update particle visual radius (fixed, not affected by smoothness)
        resourcesRef.current.depthMaterial.uniforms.uRadius.value = cfg.particleRadius;
        resourcesRef.current.thicknessMaterial.uniforms.uRadius.value = cfg.particleRadius;

        const grav = new THREE.Vector3(0, -cfg.gravity, 0).applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(scene.quaternion).invert());

        engineRef.current.step(dt, cfg, [grav.x, grav.y, grav.z]);

        const count = engineRef.current.particleCount;
        // Update GPU texture reference and particle count in shaders (no CPU position copy needed)
        const posTexture = engineRef.current.getPositionTexture();
        resourcesRef.current.depthMaterial.uniforms.tPosition.value = posTexture;
        resourcesRef.current.depthMaterial.uniforms.uParticleCount.value = count;
        resourcesRef.current.thicknessMaterial.uniforms.tPosition.value = posTexture;
        resourcesRef.current.thicknessMaterial.uniforms.uParticleCount.value = count;
        resourcesRef.current.dotMaterial.uniforms.tPosition.value = posTexture;
        resourcesRef.current.dotMaterial.uniforms.uParticleCount.value = count;
        // Draw all particles - shader checks if active via texture
        particleGeometry.setDrawRange(0, count);
        onStatsUpdate(count);


        if (cfg.renderMode === 'surface') {
          camera.updateMatrixWorld();
          // Update view matrix inverse for HDRI reflection calculations
          resourcesRef.current.finalMaterial.uniforms.uViewMatrixInverse.value = camera.matrixWorld;

          const tempBg = scene.background;
          const tempEnv = scene.environment;

          // Use showContainer config (default true if undefined)
          const showCube = cfg.showContainer !== false;
          container.visible = showCube; helper.visible = showCube; particlesDepth.visible = false;
          renderer.setRenderTarget(refractionRT);
          renderer.clear();
          renderer.render(scene, camera);

          scene.background = null;
          scene.environment = null;
          container.visible = false; helper.visible = false; particlesDepth.visible = true; scene.add(particlesDepth);
          renderer.setRenderTarget(depthRT);
          renderer.setClearColor(0x000000, 1);
          renderer.clear();
          renderer.render(scene, camera);
          scene.remove(particlesDepth);

          // Use current blur material (may have been updated)
          const currentBlurMat = resourcesRef.current.blurMaterial;
          quadMesh.material = currentBlurMat;
          // First blur pass: horizontal
          currentBlurMat.uniforms.tDepth.value = depthRT.texture;
          currentBlurMat.uniforms.uDir.value.set(1, 0);
          renderer.setRenderTarget(blurRT1);
          renderer.clear();
          renderer.render(quadScene, quadCamera);

          // First blur pass: vertical
          currentBlurMat.uniforms.tDepth.value = blurRT1.texture;
          currentBlurMat.uniforms.uDir.value.set(0, 1);
          renderer.setRenderTarget(blurRT2);
          renderer.clear();
          renderer.render(quadScene, quadCamera);

          // Second blur pass: horizontal (for smoother surface)
          currentBlurMat.uniforms.tDepth.value = blurRT2.texture;
          currentBlurMat.uniforms.uDir.value.set(1, 0);
          renderer.setRenderTarget(blurRT1);
          renderer.clear();
          renderer.render(quadScene, quadCamera);

          // Second blur pass: vertical
          currentBlurMat.uniforms.tDepth.value = blurRT1.texture;
          currentBlurMat.uniforms.uDir.value.set(0, 1);
          renderer.setRenderTarget(blurRT2);
          renderer.clear();
          renderer.render(quadScene, quadCamera);

          scene.add(particlesThickness);
          renderer.setRenderTarget(thicknessRT);
          renderer.setClearColor(0, 1);
          renderer.clear();
          renderer.render(scene, camera);
          scene.remove(particlesThickness);

          scene.background = tempBg;
          scene.environment = tempEnv;

          quadMesh.material = resourcesRef.current.finalMaterial;
          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(quadScene, quadCamera);
        } else {
          const showCube = cfg.showContainer !== false;
          container.visible = showCube; helper.visible = showCube; scene.add(particlesDots);
          renderer.setRenderTarget(null);
          renderer.clear();
          renderer.render(scene, camera);
          scene.remove(particlesDots);
        }
      } catch (error) {
        console.error('Animation error:', error);
      }
      animationId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      isRunning = false;
      if (animationId) cancelAnimationFrame(animationId);

      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      // Dispose GPU engine resources
      if (engineRef.current) {
        engineRef.current.dispose();
      }

      renderer.dispose();

      if (containerRef.current && renderer.domElement && containerRef.current.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }

      resourcesRef.current = null;
      engineRef.current = null;
    };
  }, []);

  useEffect(() => { if (triggerInject > 0 && engineRef.current) engineRef.current.addParticles(100, [0, 3, 0]); }, [triggerInject]);

  // Reset scene rotation to identity
  useEffect(() => {
    if (resetRotation > 0 && resourcesRef.current) {
      resourcesRef.current.scene.quaternion.identity();
      dragState.current.velocityX = 0;
      dragState.current.velocityY = 0;
    }
  }, [resetRotation]);
  return <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />;
};
export default FluidSimulator;
