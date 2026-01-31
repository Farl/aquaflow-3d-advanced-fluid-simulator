
import React, { useState, useEffect } from 'react';
import FluidSimulator from './components/FluidSimulator';
import { FluidConfig } from './types';
import { Droplets, Trash2, Info, Settings2, Waves, CircleDot, Zap, Box, ChevronDown, RotateCcw } from 'lucide-react';

const STORAGE_KEY = 'aquaflow-config';

const defaultConfig: FluidConfig = {
  particleRadius: 0.3,
  visualRatio: 0.7,
  viscosity: 0.04,
  gravity: 15.0,
  restDensity: 50.0,
  stiffness: 500.0,
  surfaceTension: 0.05,
  maxParticles: 6000,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  boundarySize: 10,
  renderMode: 'surface',
  renderScale: 0.5,
  // Rendering debug
  blurRadius: 0,
  blurDepthFalloff: 5,
  showContainer: true,
  // Advanced rendering
  ior: 1.33,
  refractionStrength: 0.05,
  fresnelPower: 0.4,
  fresnelIntensity: 0.02,
  fresnelBias: 0.0,
  specularPower: 32.0,
  specularIntensity: 0.25,
  edgeSampleRadius: 2.0,
  edgeSmoothness: 5.0,
  depthZOffset: 0.45,
  thicknessIntensity: 0.05,
  absorptionDensity: 0,
  waterTintR: 0.04,
  waterTintG: 0.04,
  waterTintB: 0.04,
  reflectionIntensity: 3.0,
};

const loadConfig = (): FluidConfig => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultConfig, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load config:', e);
  }
  return defaultConfig;
};

const App: React.FC = () => {
  const [config, setConfig] = useState<FluidConfig>(loadConfig);
  const [particleCount, setParticleCount] = useState(0);
  const [injectTrigger, setInjectTrigger] = useState(0);
  const [resetRotation, setResetRotation] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Auto-save config to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const handleInject = () => setInjectTrigger(prev => prev + 1);
  const handleReset = () => window.location.reload();
  const handleResetRotation = () => {
    setResetRotation(prev => prev + 1);
    setConfig(prev => ({ ...prev, rotationX: 0, rotationY: 0, rotationZ: 0 }));
  };

  const toggleRenderMode = () => {
    setConfig(prev => ({
      ...prev,
      renderMode: prev.renderMode === 'surface' ? 'dot' : 'surface'
    }));
  };


  return (
    <div className="relative w-full h-screen text-slate-200 select-none overflow-hidden bg-[#010308]">
      <div className="absolute inset-0 z-0">
        <FluidSimulator
          config={config}
          onStatsUpdate={setParticleCount}
          triggerInject={injectTrigger}
          resetRotation={resetRotation}
        />
      </div>

      <div className="absolute top-0 left-0 p-4 pointer-events-none w-full flex justify-between items-start z-10">
        <div className="pointer-events-auto" data-ui-panel>
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-blue-700 to-indigo-600 p-2 rounded-xl shadow-[0_0_30px_rgba(37,99,235,0.3)]">
              <Zap className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white leading-none">
                AQUAFLOW <span className="text-blue-400 italic text-xl">SSFR</span>
              </h1>
              <p className="text-[8px] text-blue-400/50 font-mono uppercase tracking-[0.3em]">v7.0 Screen-Space Fluid</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pointer-events-auto items-center" data-ui-panel>
          <div className="bg-black/60 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/10 flex items-center gap-3">
            <span className="text-[9px] uppercase text-blue-300/60 font-bold tracking-wider">Particles</span>
            <span className="text-xl font-mono text-white leading-none">{particleCount.toLocaleString()}</span>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2.5 rounded-xl border transition-all duration-300 ${showSettings ? 'bg-blue-600 border-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.3)]' : 'bg-black/60 border-white/10'}`}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </div>

      <div className={`absolute right-4 top-28 w-72 max-h-[calc(100vh-140px)] overflow-y-auto transition-all duration-500 pointer-events-none ${showSettings ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0'}`}>
        <div className="pointer-events-auto" data-ui-panel>
          <div className="bg-black/85 backdrop-blur-xl p-4 rounded-2xl border border-white/10 shadow-2xl space-y-3">

            <div className="flex gap-2">
              <button
                onClick={handleInject}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:brightness-110 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.97] text-[10px] tracking-widest uppercase"
              >
                <Droplets size={14} />
                Inject
              </button>
              <button
                onClick={toggleRenderMode}
                className={`flex-1 py-2.5 rounded-xl border flex items-center justify-center gap-2 text-[10px] font-bold transition-all ${config.renderMode === 'surface' ? 'bg-blue-500/20 border-blue-400/40 text-blue-300' : 'bg-slate-500/20 border-slate-400/40 text-slate-300'}`}
              >
                {config.renderMode === 'surface' ? <Waves size={14} /> : <CircleDot size={14} />}
                {config.renderMode === 'surface' ? 'LIQUID' : 'DOTS'}
              </button>
              <button
                onClick={handleReset}
                className="px-2.5 py-2.5 rounded-xl border bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                title="Clear particles"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => { localStorage.removeItem(STORAGE_KEY); window.location.reload(); }}
                className="px-2.5 py-2.5 rounded-xl border bg-orange-500/10 border-orange-500/20 text-orange-400 hover:bg-orange-500/20 transition-colors"
                title="Reset to defaults"
              >
                <RotateCcw size={14} />
              </button>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-bold text-white/50 uppercase tracking-wider">
                  <span>Stiffness</span>
                  <span className="text-blue-400">{config.stiffness.toFixed(0)}</span>
                </div>
                <input
                  type="range" min="500" max="5000" step="250"
                  value={config.stiffness}
                  onChange={e => setConfig(prev => ({ ...prev, stiffness: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-bold text-white/50 uppercase tracking-wider">
                  <span>Surface Tension</span>
                  <span className="text-blue-400">{config.surfaceTension.toFixed(2)}</span>
                </div>
                <input
                  type="range" min="0" max="0.1" step="0.005"
                  value={config.surfaceTension}
                  onChange={e => setConfig(prev => ({ ...prev, surfaceTension: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-bold text-white/50 uppercase tracking-wider">
                  <span>Particle Size</span>
                  <span className="text-blue-400">{config.particleRadius.toFixed(2)}</span>
                </div>
                <input
                  type="range" min="0.2" max="1.5" step="0.05"
                  value={config.particleRadius}
                  onChange={e => setConfig(prev => ({ ...prev, particleRadius: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-bold text-white/50 uppercase tracking-wider">
                  <span>Smoothness</span>
                  <span className="text-blue-400">{config.visualRatio.toFixed(1)}</span>
                </div>
                <input
                  type="range" min="0.3" max="1.5" step="0.1"
                  value={config.visualRatio}
                  onChange={e => setConfig(prev => ({ ...prev, visualRatio: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[9px] font-bold text-white/50 uppercase tracking-wider">
                  <span className="flex items-center gap-1">Render Scale <Zap size={9} className="text-yellow-500" title="Affects performance" /></span>
                  <span className="text-blue-400">{(config.renderScale * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range" min="0.25" max="1" step="0.25"
                  value={config.renderScale}
                  onChange={e => setConfig(prev => ({ ...prev, renderScale: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                />
              </div>

              <div className="border-t border-white/5 pt-2 mt-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">Liquid Render</span>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, showContainer: !prev.showContainer }))}
                    className={`text-[8px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${config.showContainer ? 'bg-blue-500/20 text-blue-400' : 'bg-white/10 text-white/40'}`}
                  >
                    <Box size={10} />
                    Cube
                  </button>
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px] font-bold text-white/40">
                      <span className="flex items-center gap-1">Blur Radius <Zap size={8} className="text-yellow-500" title="Affects performance" /></span>
                      <span className="text-cyan-400">{config.blurRadius}</span>
                    </div>
                    <input
                      type="range" min="0" max="10" step="1"
                      value={config.blurRadius}
                      onChange={e => setConfig(prev => ({ ...prev, blurRadius: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px] font-bold text-white/40">
                      <span>Depth Falloff</span>
                      <span className="text-cyan-400">{config.blurDepthFalloff}</span>
                    </div>
                    <input
                      type="range" min="1" max="100" step="1"
                      value={config.blurDepthFalloff}
                      onChange={e => setConfig(prev => ({ ...prev, blurDepthFalloff: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-white/5 pt-2 mt-2">
                <div className="flex justify-between items-center mb-2">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1"
                  >
                    <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">Advanced Rendering</span>
                    <ChevronDown size={14} className={`text-white/40 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                  </button>
                  {showAdvanced && (
                    <button
                      onClick={() => setConfig(prev => ({
                        ...prev,
                        ior: 1.33, refractionStrength: 0.05, fresnelPower: 0.4, fresnelIntensity: 0.02, fresnelBias: 0.0,
                        specularPower: 32.0, specularIntensity: 0.25, edgeSampleRadius: 2.0, edgeSmoothness: 5.0,
                        depthZOffset: 0.45, thicknessIntensity: 0.05, absorptionDensity: 0,
                        waterTintR: 0.04, waterTintG: 0.04, waterTintB: 0.04, reflectionIntensity: 3.0
                      }))}
                      className="text-[8px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {showAdvanced && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>HDRI Reflection</span>
                        <span className="text-emerald-400">{config.reflectionIntensity.toFixed(2)}</span>
                      </div>
                      <input
                        type="range" min="0" max="5.0" step="0.1"
                        value={config.reflectionIntensity}
                        onChange={e => setConfig(prev => ({ ...prev, reflectionIntensity: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Absorption Density</span>
                        <span className="text-blue-400">{config.absorptionDensity.toFixed(1)}</span>
                      </div>
                      <input
                        type="range" min="0" max="10" step="0.5"
                        value={config.absorptionDensity}
                        onChange={e => setConfig(prev => ({ ...prev, absorptionDensity: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>IOR (Refraction)</span>
                        <span className="text-purple-400">{config.ior.toFixed(2)}</span>
                      </div>
                      <input
                        type="range" min="1.0" max="2.0" step="0.05"
                        value={config.ior}
                        onChange={e => setConfig(prev => ({ ...prev, ior: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Refraction Strength</span>
                        <span className="text-purple-400">{config.refractionStrength.toFixed(3)}</span>
                      </div>
                      <input
                        type="range" min="0" max="0.2" step="0.005"
                        value={config.refractionStrength}
                        onChange={e => setConfig(prev => ({ ...prev, refractionStrength: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Fresnel Power</span>
                        <span className="text-purple-400">{config.fresnelPower.toFixed(1)}</span>
                      </div>
                      <input
                        type="range" min="0.1" max="20" step="0.1"
                        value={config.fresnelPower}
                        onChange={e => setConfig(prev => ({ ...prev, fresnelPower: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Fresnel Intensity</span>
                        <span className="text-purple-400">{config.fresnelIntensity.toFixed(3)}</span>
                      </div>
                      <input
                        type="range" min="0" max="0.5" step="0.01"
                        value={config.fresnelIntensity}
                        onChange={e => setConfig(prev => ({ ...prev, fresnelIntensity: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Fresnel Bias</span>
                        <span className="text-purple-400">{config.fresnelBias.toFixed(3)}</span>
                      </div>
                      <input
                        type="range" min="-0.5" max="0.5" step="0.01"
                        value={config.fresnelBias}
                        onChange={e => setConfig(prev => ({ ...prev, fresnelBias: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Specular Power</span>
                        <span className="text-orange-400">{config.specularPower.toFixed(0)}</span>
                      </div>
                      <input
                        type="range" min="4" max="128" step="4"
                        value={config.specularPower}
                        onChange={e => setConfig(prev => ({ ...prev, specularPower: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-orange-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Specular Intensity</span>
                        <span className="text-orange-400">{config.specularIntensity.toFixed(2)}</span>
                      </div>
                      <input
                        type="range" min="0" max="1" step="0.05"
                        value={config.specularIntensity}
                        onChange={e => setConfig(prev => ({ ...prev, specularIntensity: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-orange-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Edge Sample Radius</span>
                        <span className="text-pink-400">{config.edgeSampleRadius.toFixed(1)}</span>
                      </div>
                      <input
                        type="range" min="1" max="5" step="0.5"
                        value={config.edgeSampleRadius}
                        onChange={e => setConfig(prev => ({ ...prev, edgeSampleRadius: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-pink-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Edge Smoothness</span>
                        <span className="text-pink-400">{config.edgeSmoothness.toFixed(1)}</span>
                      </div>
                      <input
                        type="range" min="1" max="8" step="0.5"
                        value={config.edgeSmoothness}
                        onChange={e => setConfig(prev => ({ ...prev, edgeSmoothness: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-pink-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Depth Z Offset</span>
                        <span className="text-teal-400">{config.depthZOffset.toFixed(2)}</span>
                      </div>
                      <input
                        type="range" min="0.1" max="1.0" step="0.05"
                        value={config.depthZOffset}
                        onChange={e => setConfig(prev => ({ ...prev, depthZOffset: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-teal-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Thickness Intensity</span>
                        <span className="text-teal-400">{config.thicknessIntensity.toFixed(3)}</span>
                      </div>
                      <input
                        type="range" min="0" max="0.2" step="0.01"
                        value={config.thicknessIntensity}
                        onChange={e => setConfig(prev => ({ ...prev, thicknessIntensity: parseFloat(e.target.value) }))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-teal-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[8px] font-bold text-white/40">
                        <span>Water Tint RGB</span>
                        <span className="text-sky-400">{config.waterTintR.toFixed(2)}, {config.waterTintG.toFixed(2)}, {config.waterTintB.toFixed(2)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <input
                          type="range" min="0" max="1.0" step="0.01"
                          value={config.waterTintR}
                          onChange={e => setConfig(prev => ({ ...prev, waterTintR: parseFloat(e.target.value) }))}
                          className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-red-400"
                        />
                        <input
                          type="range" min="0" max="1.0" step="0.01"
                          value={config.waterTintG}
                          onChange={e => setConfig(prev => ({ ...prev, waterTintG: parseFloat(e.target.value) }))}
                          className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-green-400"
                        />
                        <input
                          type="range" min="0" max="1.0" step="0.01"
                          value={config.waterTintB}
                          onChange={e => setConfig(prev => ({ ...prev, waterTintB: parseFloat(e.target.value) }))}
                          className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-400"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-white/5 pt-2 mt-2">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">Spin Speed</span>
                  <button
                    onClick={handleResetRotation}
                    className="text-[8px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
                  >
                    Reset
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px] font-bold text-white/40">
                      <span>X</span>
                      <span className="text-red-400">{config.rotationX.toFixed(1)}</span>
                    </div>
                    <input
                      type="range" min="-2" max="2" step="0.1"
                      value={config.rotationX}
                      onChange={e => setConfig(prev => ({ ...prev, rotationX: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-red-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px] font-bold text-white/40">
                      <span>Y</span>
                      <span className="text-green-400">{config.rotationY.toFixed(1)}</span>
                    </div>
                    <input
                      type="range" min="-2" max="2" step="0.1"
                      value={config.rotationY}
                      onChange={e => setConfig(prev => ({ ...prev, rotationY: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-green-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-[8px] font-bold text-white/40">
                      <span>Z</span>
                      <span className="text-blue-400">{config.rotationZ.toFixed(1)}</span>
                    </div>
                    <input
                      type="range" min="-2" max="2" step="0.1"
                      value={config.rotationZ}
                      onChange={e => setConfig(prev => ({ ...prev, rotationZ: parseFloat(e.target.value) }))}
                      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowInfo(true)}
              className="w-full py-1.5 text-[8px] text-white/30 hover:text-blue-400 font-bold uppercase tracking-widest flex items-center justify-center gap-2 border-t border-white/5 pt-2 transition-all"
            >
              <Info size={10} />
              Engine Spec
            </button>
          </div>
        </div>
      </div>

      {showInfo && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl transition-all" data-ui-panel>
          <div className="max-w-lg bg-[#030610] border border-white/10 p-8 rounded-2xl shadow-2xl relative">
            <button onClick={() => setShowInfo(false)} className="absolute top-4 right-4 text-white/30 hover:text-white">
              <Trash2 size={18} />
            </button>
            <h2 className="text-3xl font-black mb-4 text-white">SSFR <span className="text-blue-500">v7</span></h2>
            <p className="text-white/50 text-sm leading-relaxed mb-4">
              AquaFlow v7 implements <strong className="text-white">Screen-Space Fluid Rendering</strong>. Surface normals are reconstructed from a smoothed depth buffer, enabling real-time refraction and reflection.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <div className="text-blue-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Beer-Lambert</div>
                <p className="text-[11px] text-white/40">Thickness-based light absorption for realistic depth.</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <div className="text-blue-400 font-bold mb-1 text-[10px] uppercase tracking-wider">Depth Gradient</div>
                <p className="text-[11px] text-white/40">Normals derived from view-space depth derivatives.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
