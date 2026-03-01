// Global management
const appState = {
    currentSection: 'motorEffect',
    savedConfigurations: [],
    lastUsedConfig: null,
    webGLAvailable: true,
    is2DFallback: false
};

const defaultConfig = {
    id: 'default',
    name: "Default Configuration",
    date: new Date().toISOString(),
    motorEffect: {
        current: 5,
        fieldStrength: 5,
        wireLength: 10,
        isRunning: false
    },
    commutator: {
        currentStrength: 50,
        magneticField: 50,
        coilTurns: 50,
        isRotating: false,
        rotationDirection: 1
    }
};

// Memory management
class MemoryManager {
    constructor() {
        this.disposableObjects = [];
        this.cleanupQueue = [];
        this.isCleaning = false;
    }

    register(object) {
        if (object && object.dispose) {
            this.disposableObjects.push(object);
        }
        return object;
    }

    cleanup() {
        if (this.isCleaning) return;
        
        this.isCleaning = true;
        
        this.cleanupQueue.forEach(obj => {
            try {
                if (obj.parent) obj.parent.remove(obj);
                if (obj.dispose) obj.dispose();
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            } catch (e) {
                console.warn('Cleanup error:', e);
            }
        });
        
        this.cleanupQueue = [];
        this.isCleaning = false;
    }

    queueForCleanup(object) {
        if (object) {
            this.cleanupQueue.push(object);
        }
    }

    clearAll() {
        this.disposableObjects.forEach(obj => {
            try {
                if (obj.dispose) obj.dispose();
            } catch (e) {
                console.warn('Dispose error:', e);
            }
        });
        this.disposableObjects = [];
        this.cleanup();
    }
}

const memoryManager = new MemoryManager();

// 3D Simulation variables
let scene, camera, renderer, controls;
let wire, magneticField, forceArrow;
let currentValue = 5;
let fieldStrengthValue = 5;
let wireLengthValue = 10;
let isSimulationRunning = false;

// Commutator variables
let commutatorScene, commutatorCamera, commutatorRenderer, commutatorControls;
let stationaryMagnets, rotatingParts, coil, splitRing;
let brushPositive, brushNegative;
let isCommutatorRotating = false;
let rotationDirection = 1;
let currentStrength = 0.5;
let magneticFieldStrength = 0.5;
let coilTurns = 0.5;

// Animation frame ID for cleanup
let animationFrameId = null;

// Event delegation
class EventDelegator {
    constructor() {
        this.handlers = new Map();
    }

    setupGlobalListeners() {
        document.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;

            const id = target.id;
            const handlers = this.handlers.get(id);
            
            if (handlers) {
                handlers.forEach(handler => handler(e));
            }
        });

        document.addEventListener('input', (e) => {
            if (e.target.type === 'range') {
                const id = e.target.id;
                const handlers = this.handlers.get(id);
                
                if (handlers) {
                    handlers.forEach(handler => handler(e));
                }
            }
            
            // Also handle calculator inputs for real-time calculation
            if (e.target.id === 'magneticField' || e.target.id === 'currentInput' || 
                e.target.id === 'length' || e.target.id === 'angle') {
                calculateForceAdvanced();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT' && 
                document.activeElement.tagName !== 'TEXTAREA') {
                e.preventDefault();
                toggleSimulation();
            }
            
            if (e.code === 'Escape') {
                const modal = document.getElementById('saveModal');
                if (modal.classList.contains('active')) {
                    closeSaveModal();
                }
            }
        });
        
        // Unit change listeners for calculator
        ['bUnit', 'iUnit', 'lUnit'].forEach(unitId => {
            const unitSelect = document.getElementById(unitId);
            if (unitSelect) {
                unitSelect.addEventListener('change', calculateForceAdvanced);
            }
        });
    }

    register(id, handler) {
        if (!this.handlers.has(id)) {
            this.handlers.set(id, []);
        }
        this.handlers.get(id).push(handler);
    }
}

const eventDelegator = new EventDelegator();

// WebGL detection and fallback
function checkWebGLAvailability() {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        appState.webGLAvailable = !!gl;
        
        if (!appState.webGLAvailable) {
            console.log('WebGL not available. Using 2D fallback mode.');
            appState.is2DFallback = true;
            init2DFallback();
        }
    } catch (e) {
        console.log('WebGL detection failed:', e);
        appState.webGLAvailable = false;
        appState.is2DFallback = true;
        init2DFallback();
    }
}

function init2DFallback() {
    const simulationContainer = document.getElementById('simulation');
    if (simulationContainer) {
        simulationContainer.innerHTML = `
            <div class="fallback-2d" style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white;">
                <h3 style="margin-bottom: 20px;">2D Simulation Mode</h3>
                <div style="display: flex; align-items: center; gap: 30px;">
                    <div style="text-align: center;">
                        <div style="width: 100px; height: 100px; border: 2px solid red; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center;">
                            <span style="font-size: 24px;">N</span>
                        </div>
                        <div>North Pole</div>
                    </div>
                    <div style="width: 200px; height: 10px; background: yellow; position: relative;">
                        <div style="position: absolute; top: -10px; left: 50%; transform: translateX(-50%); color: orange;">→ I</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="width: 100px; height: 100px; border: 2px solid blue; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center;">
                            <span style="font-size: 24px;">S</span>
                        </div>
                        <div>South Pole</div>
                    </div>
                </div>
                <div style="margin-top: 30px; font-size: 18px;">
                    Force Direction: <span id="forceDirection">↑</span>
                </div>
                <div style="margin-top: 10px;">
                    Force Magnitude: <span id="forceMagnitude">0</span> N
                </div>
                <div style="margin-top: 30px; color: #aaa; font-size: 14px;">
                    Note: 3D graphics unavailable. Showing simplified 2D representation.
                </div>
            </div>
        `;
    }
}

// 3D Simulation functions
function init() {
    if (appState.is2DFallback) return;
    
    console.log("Initializing 3D simulation...");
    
    try {
        scene = memoryManager.register(new THREE.Scene());
        scene.background = new THREE.Color(0x111125);
        
        const container = document.getElementById('simulation');
        if (!container) {
            console.error("Simulation container not found!");
            return;
        }
        
        camera = memoryManager.register(new THREE.PerspectiveCamera(
            75, 
            container.clientWidth / container.clientHeight, 
            0.1, 
            1000
        ));
        camera.position.set(3, 2, 5);
        
        renderer = memoryManager.register(new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        }));
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        
        const existingCanvas = container.querySelector('canvas');
        if (existingCanvas) {
            existingCanvas.remove();
        }
        
        container.insertBefore(renderer.domElement, container.firstChild);
        
        controls = memoryManager.register(new THREE.OrbitControls(camera, renderer.domElement));
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        
        const ambientLight = memoryManager.register(new THREE.AmbientLight(0xffffff, 0.7));
        scene.add(ambientLight);
        
        const directionalLight = memoryManager.register(new THREE.DirectionalLight(0xffffff, 0.9));
        directionalLight.position.set(5, 10, 7);
        scene.add(directionalLight);
        
        createMagneticField();
        createWire();
        createForceArrow();
        
        window.addEventListener('resize', throttle(onWindowResize, 250));
        
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        animate();
        
        console.log("3D simulation initialized successfully!");
        
    } catch (error) {
        console.error("3D initialization failed:", error);
        showNotification('3D graphics failed. Switching to 2D mode.', '#ff416c');
        appState.is2DFallback = true;
        init2DFallback();
    }
}

function createMagneticField() {
    if (magneticField) {
        memoryManager.queueForCleanup(magneticField);
        scene.remove(magneticField);
    }
    
    magneticField = memoryManager.register(new THREE.Group());
    
    const poleGeometry = memoryManager.register(new THREE.BoxGeometry(0.8, 0.8, 0.8));
    const northMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xff0000,
        emissive: 0x660000,
        emissiveIntensity: Math.min(fieldStrengthValue / 50, 0.5)
    }));
    const southMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0x0000ff,
        emissive: 0x000066,
        emissiveIntensity: Math.min(fieldStrengthValue / 50, 0.5)
    }));
    
    const northPole = memoryManager.register(new THREE.Mesh(poleGeometry, northMaterial));
    const southPole = memoryManager.register(new THREE.Mesh(poleGeometry, southMaterial));
    northPole.position.set(0, 0, -2);
    southPole.position.set(0, 0, 2);
    
    magneticField.add(northPole, southPole);
    
    const fieldLineCount = Math.floor(4 + (fieldStrengthValue / 25));
    const fieldLineLength = 2 + (fieldStrengthValue / 50);
    
    for (let i = -1; i <= 1; i += 1.6/fieldLineCount) {
        for (let j = -1; j <= 1; j += 1.6/fieldLineCount) {
            const fieldLine = memoryManager.register(new THREE.ArrowHelper(
                new THREE.Vector3(0, 0, 1),
                new THREE.Vector3(i, j, -1.5),
                fieldLineLength, 0x00ff00, 0.4, 0.2
            ));
            magneticField.add(fieldLine);
        }
    }
    
    scene.add(magneticField);
}

function createWire() {
    if (wire) {
        memoryManager.queueForCleanup(wire);
        scene.remove(wire);
    }
    
    // Improved wire length visualization using logarithmic scaling
    // This ensures wire length variations are visible across the full range
    const minDisplayLength = 0.8;
    const maxDisplayLength = 4.0;
    
    // Map wireLengthValue (0-100) to display length using logarithmic scale
    let displayLength;
    if (wireLengthValue <= 0) {
        displayLength = 0.2;
    } else {
        // Logarithmic mapping: longer wires show diminishing returns in visual length
        // but still show variation across the whole range
        const logMin = Math.log10(1);
        const logMax = Math.log10(101);
        const logValue = Math.log10(wireLengthValue + 1);
        const t = (logValue - logMin) / (logMax - logMin);
        displayLength = minDisplayLength + t * (maxDisplayLength - minDisplayLength);
    }
    
    const wireGeometry = memoryManager.register(new THREE.CylinderGeometry(0.08, 0.08, displayLength, 12));
    
    const wireMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: Math.min(currentValue / 50, 0.8)
    }));
    
    wire = memoryManager.register(new THREE.Mesh(wireGeometry, wireMaterial));
    wire.rotation.x = Math.PI / 2;
    wire.position.y = 0.5;
    
    const currentArrow = memoryManager.register(new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-displayLength / 2, 0.5, 0),
        0.5 + (currentValue / 100), 0xff6600, 0.3, 0.15
    ));
    wire.add(currentArrow);
    
    scene.add(wire);
}

function createForceArrow() {
    if (forceArrow) {
        memoryManager.queueForCleanup(forceArrow);
        scene.remove(forceArrow);
    }
    
    forceArrow = memoryManager.register(new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0.5, 0),
        0.5, 0xffffff, 0.4, 0.2
    ));
    scene.add(forceArrow);
}

let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000 / 60;

function animate(currentTime = 0) {
    animationFrameId = requestAnimationFrame(animate);
    
    const deltaTime = currentTime - lastUpdateTime;
    if (deltaTime < UPDATE_INTERVAL) return;
    
    lastUpdateTime = currentTime;
    
    if (scene && camera && renderer) {
        controls.update();
        
        if (isSimulationRunning) {
            const forceMagnitude = fieldStrengthValue * currentValue * wireLengthValue;
            
            // Improved force visualization - no artificial cap
            // Use logarithmic scaling for wide range (0 to 1,000,000)
            let displayForce;
            if (forceMagnitude <= 0) {
                displayForce = 0;
            } else if (forceMagnitude < 100) {
                displayForce = forceMagnitude / 50; // Linear for small forces
            } else {
                // Logarithmic for large forces, but ensure it keeps increasing
                displayForce = 2 + Math.log10(forceMagnitude / 10);
            }
            
            // Clamp to reasonable visual range but ensure it doesn't cap artificially
            displayForce = Math.min(Math.max(displayForce, 0.2), 6);
            
            if (forceArrow) {
                forceArrow.setLength(displayForce, 0.4, 0.2);
                const pulse = 1 + 0.2 * Math.sin(currentTime * 0.003);
                forceArrow.scale.set(pulse, pulse, pulse);
                
                const hue = 0.6 - (Math.min(forceMagnitude / 10000, 0.6));
                forceArrow.setColor(new THREE.Color().setHSL(hue, 1, 0.5));
            }
        }
        
        renderer.render(scene, camera);
    }
    
    if (commutatorScene && commutatorCamera && commutatorRenderer) {
        if (commutatorControls) commutatorControls.update();
        
        if (isCommutatorRotating && rotatingParts) {
            const baseSpeed = 0.01;
            // Multiplicative effect: current × field × turns
            const speedFactor = currentStrength * magneticFieldStrength * coilTurns * 8;
            
            rotatingParts.rotation.y += baseSpeed * rotationDirection * speedFactor;
            const rotationAngle = rotatingParts.rotation.y % (Math.PI * 2);
            updateBrushContact(rotationAngle);
        }
        
        commutatorRenderer.render(commutatorScene, commutatorCamera);
    }
    
    if (currentTime % 5000 < 16) {
        memoryManager.cleanup();
    }
}

// Commutator simulation
function initCommutator() {
    if (appState.is2DFallback) return;
    
    console.log("Initializing commutator 3D simulation...");
    
    const commutatorContainer = document.getElementById('commutator-simulation');
    if (!commutatorContainer) {
        console.error("Commutator container not found!");
        return;
    }
    
    try {
        commutatorScene = memoryManager.register(new THREE.Scene());
        commutatorScene.background = new THREE.Color(0x0a0a1a);
        
        commutatorCamera = memoryManager.register(new THREE.PerspectiveCamera(
            75,
            commutatorContainer.clientWidth / commutatorContainer.clientHeight,
            0.1,
            1000
        ));
        commutatorCamera.position.set(4, 3, 6);
        
        commutatorRenderer = memoryManager.register(new THREE.WebGLRenderer({
            antialias: true,
            alpha: true
        }));
        commutatorRenderer.setSize(commutatorContainer.clientWidth, commutatorContainer.clientHeight);
        commutatorRenderer.setPixelRatio(window.devicePixelRatio);
        
        const existingCanvas = commutatorContainer.querySelector('canvas');
        if (existingCanvas) {
            commutatorContainer.removeChild(existingCanvas);
        }
        
        commutatorContainer.appendChild(commutatorRenderer.domElement);
        
        commutatorControls = memoryManager.register(new THREE.OrbitControls(commutatorCamera, commutatorRenderer.domElement));
        commutatorControls.enableDamping = true;
        
        const ambientLight2 = memoryManager.register(new THREE.AmbientLight(0xffffff, 0.8));
        commutatorScene.add(ambientLight2);
        
        const directionalLight2 = memoryManager.register(new THREE.DirectionalLight(0xffffff, 1.0));
        directionalLight2.position.set(5, 10, 7);
        commutatorScene.add(directionalLight2);
        
        createGCSETextbookCommutator();
        window.commutatorInitialized = true;
        
        console.log("Commutator 3D simulation initialized successfully!");
        
    } catch (error) {
        console.error("Commutator initialization failed:", error);
        showNotification('Commutator 3D failed. Using simplified view.', '#ff9800');
    }
}

function createGCSETextbookCommutator() {
    if (stationaryMagnets) {
        memoryManager.queueForCleanup(stationaryMagnets);
        commutatorScene.remove(stationaryMagnets);
    }
    if (rotatingParts) {
        memoryManager.queueForCleanup(rotatingParts);
        commutatorScene.remove(rotatingParts);
    }
    
    stationaryMagnets = memoryManager.register(new THREE.Group());
    
    const poleGeometry = memoryManager.register(new THREE.BoxGeometry(1.2, 3.0, 0.6));
    const northMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xff0000,
        emissive: 0x660000,
        emissiveIntensity: 0.5 * magneticFieldStrength
    }));
    const southMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0x0000ff,
        emissive: 0x000066,
        emissiveIntensity: 0.5 * magneticFieldStrength
    }));
    
    const northPole = memoryManager.register(new THREE.Mesh(poleGeometry, northMaterial));
    const southPole = memoryManager.register(new THREE.Mesh(poleGeometry, southMaterial));
    northPole.position.set(-2.0, 0, 0);
    southPole.position.set(2.0, 0, 0);
    
    stationaryMagnets.add(northPole, southPole);
    
    rotatingParts = memoryManager.register(new THREE.Group());
    
    coil = memoryManager.register(new THREE.Group());
    const coilWidth = 1.6;
    const coilHeight = 2.2;
    const wireThickness = 0.1;
    
    const coilMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.4 * currentStrength
    }));
    
    const sideGeometry = memoryManager.register(new THREE.BoxGeometry(wireThickness, coilHeight, wireThickness));
    const horizontalGeometry = memoryManager.register(new THREE.BoxGeometry(coilWidth, wireThickness, wireThickness));
    
    const leftSide = memoryManager.register(new THREE.Mesh(sideGeometry, coilMaterial));
    leftSide.position.set(-coilWidth / 2, 0, 0);
    
    const rightSide = memoryManager.register(new THREE.Mesh(sideGeometry, coilMaterial));
    rightSide.position.set(coilWidth / 2, 0, 0);
    
    const topSide = memoryManager.register(new THREE.Mesh(horizontalGeometry, coilMaterial));
    topSide.position.set(0, coilHeight / 2, 0);
    
    const bottomSide = memoryManager.register(new THREE.Mesh(horizontalGeometry, coilMaterial));
    bottomSide.position.set(0, -coilHeight / 2, 0);
    
    coil.add(leftSide, rightSide, topSide, bottomSide);
    
    const connectionMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.3 * currentStrength
    }));
    
    const connectionGeometry = memoryManager.register(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8));
    
    const leftConnection = memoryManager.register(new THREE.Mesh(connectionGeometry, connectionMaterial));
    leftConnection.position.set(-coilWidth / 2, -coilHeight / 2 - 0.5, 0);
    leftConnection.rotation.z = Math.PI / 2;
    
    const rightConnection = memoryManager.register(new THREE.Mesh(connectionGeometry, connectionMaterial));
    rightConnection.position.set(coilWidth / 2, -coilHeight / 2 - 0.5, 0);
    rightConnection.rotation.z = Math.PI / 2;
    
    coil.add(leftConnection, rightConnection);
    rotatingParts.add(coil);
    
    splitRing = memoryManager.register(new THREE.Group());
    const ringRadius = 0.5;
    const ringHeight = 0.3;
    
    const ring1Geometry = memoryManager.register(new THREE.CylinderGeometry(
        ringRadius, ringRadius, ringHeight, 16, 1, false, 0, Math.PI
    ));
    const ring1Material = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xff4444,
        emissive: 0xff0000,
        emissiveIntensity: 0.6 * currentStrength
    }));
    const ring1 = memoryManager.register(new THREE.Mesh(ring1Geometry, ring1Material));
    ring1.rotation.x = Math.PI / 2;
    ring1.rotation.z = Math.PI / 2;
    
    const ring2Geometry = memoryManager.register(new THREE.CylinderGeometry(
        ringRadius, ringRadius, ringHeight, 16, 1, false, 0, Math.PI
    ));
    const ring2Material = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0x4444ff,
        emissive: 0x0000ff,
        emissiveIntensity: 0.6 * currentStrength
    }));
    const ring2 = memoryManager.register(new THREE.Mesh(ring2Geometry, ring2Material));
    ring2.rotation.x = Math.PI / 2;
    ring2.rotation.z = -Math.PI / 2;
    
    const gapGeometry = memoryManager.register(new THREE.BoxGeometry(0.12, ringHeight, 0.2));
    const gapMaterial = memoryManager.register(new THREE.MeshPhongMaterial({ color: 0x000000 }));
    const gap = memoryManager.register(new THREE.Mesh(gapGeometry, gapMaterial));
    gap.position.set(ringRadius, 0, 0);
    
    splitRing.add(ring1, ring2, gap);
    splitRing.position.y = -coilHeight / 2 - 1.1;
    rotatingParts.add(splitRing);
    
    const shaftGeometry = memoryManager.register(new THREE.CylinderGeometry(0.1, 0.1, 5, 8));
    const shaftMaterial = memoryManager.register(new THREE.MeshPhongMaterial({ color: 0x888888 }));
    const shaft = memoryManager.register(new THREE.Mesh(shaftGeometry, shaftMaterial));
    shaft.rotation.x = Math.PI / 2;
    rotatingParts.add(shaft);
    
    const brushGeometry = memoryManager.register(new THREE.BoxGeometry(0.25, 0.25, 1.2));
    const brushMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xcccccc,
        emissive: 0x666666,
        emissiveIntensity: 0.4 * currentStrength
    }));
    
    brushPositive = memoryManager.register(new THREE.Mesh(brushGeometry, brushMaterial));
    brushPositive.position.set(-ringRadius - 0.4, -coilHeight / 2 - 1.1, 0.4);
    brushPositive.rotation.x = Math.PI / 6;
    
    brushNegative = memoryManager.register(new THREE.Mesh(brushGeometry, brushMaterial));
    brushNegative.position.set(ringRadius + 0.4, -coilHeight / 2 - 1.1, 0.4);
    brushNegative.rotation.x = -Math.PI / 6;
    
    stationaryMagnets.add(brushPositive, brushNegative);
    
    createCurrentFlowIndicators();
    
    commutatorScene.add(stationaryMagnets);
    commutatorScene.add(rotatingParts);
}

function createCurrentFlowIndicators() {
    if (coil.userData && coil.userData.particles) {
        memoryManager.queueForCleanup(coil.userData.particles);
        coil.remove(coil.userData.particles);
    }
    
    const particles = memoryManager.register(new THREE.Group());
    const particleCount = Math.floor(10 * currentStrength);
    const coilWidth = 1.6;
    const coilHeight = 2.2;
    
    const particleGeometry = memoryManager.register(new THREE.SphereGeometry(0.05, 8, 8));
    
    for (let i = 0; i < particleCount; i++) {
        const particleMaterial = memoryManager.register(new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.8 * currentStrength
        }));
        
        const particle = memoryManager.register(new THREE.Mesh(particleGeometry, particleMaterial));
        const t = i / particleCount;
        let x, y;
        
        if (t < 0.25) {
            x = -coilWidth / 2 + (coilWidth * (t / 0.25));
            y = coilHeight / 2;
        } else if (t < 0.5) {
            x = coilWidth / 2;
            y = coilHeight / 2 - (coilHeight * ((t - 0.25) / 0.25));
        } else if (t < 0.75) {
            x = coilWidth / 2 - (coilWidth * ((t - 0.5) / 0.25));
            y = -coilHeight / 2;
        } else {
            x = -coilWidth / 2;
            y = -coilHeight / 2 + (coilHeight * ((t - 0.75) / 0.25));
        }
        
        particle.position.set(x, y, 0);
        particles.add(particle);
    }
    
    coil.add(particles);
    coil.userData = { particles: particles };
}

function updateBrushContact(angle) {
    const normalizedAngle = (angle + Math.PI * 2) % (Math.PI * 2);
    if (brushPositive && brushNegative) {
        if (normalizedAngle < Math.PI) {
            brushPositive.material.emissive.setHex(0xff0000);
            brushPositive.material.emissiveIntensity = 0.5 * currentStrength;
            brushNegative.material.emissive.setHex(0x000000);
            brushNegative.material.emissiveIntensity = 0;
        } else {
            brushPositive.material.emissive.setHex(0x000000);
            brushPositive.material.emissiveIntensity = 0;
            brushNegative.material.emissive.setHex(0x0000ff);
            brushNegative.material.emissiveIntensity = 0.5 * currentStrength;
        }
    }
}

// Export/Import functions
function exportConfiguration(config) {
    try {
        const dataStr = JSON.stringify(config, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `motor-effect-config-${new Date().toISOString().slice(0,10)}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        showNotification('Configuration exported successfully!', '#4CAF50');
    } catch (error) {
        console.error('Export failed:', error);
        showNotification('Export failed: ' + error.message, '#ff416c');
    }
}

function importConfiguration(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const config = JSON.parse(e.target.result);
            
            // Validate configuration
            if (config && config.motorEffect && config.commutator) {
                // Add to saved configurations
                config.id = Date.now().toString();
                config.date = new Date().toISOString();
                
                appState.savedConfigurations.unshift(config);
                saveToLocalStorage();
                displaySavedConfigurations();
                
                loadConfiguration(config);
                showNotification('Configuration imported successfully!', '#4CAF50');
            } else {
                showNotification('Invalid configuration file', '#ff416c');
            }
        } catch (error) {
            console.error('Import failed:', error);
            showNotification('Error reading configuration file', '#ff416c');
        }
        
        // Clear the file input
        event.target.value = '';
    };
    reader.readAsText(file);
}

function validateConfiguration(config) {
    return config &&
           config.motorEffect &&
           typeof config.motorEffect.current === 'number' &&
           typeof config.motorEffect.fieldStrength === 'number' &&
           typeof config.motorEffect.wireLength === 'number' &&
           config.commutator &&
           typeof config.commutator.currentStrength === 'number' &&
           typeof config.commutator.magneticField === 'number' &&
           typeof config.commutator.coilTurns === 'number';
}

// Utility functions
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

function onWindowResize() {
    const container = document.getElementById('simulation');
    const commutatorContainer = document.getElementById('commutator-simulation');
    
    if (container && camera && renderer) {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
    
    if (commutatorContainer && commutatorCamera && commutatorRenderer) {
        commutatorCamera.aspect = commutatorContainer.clientWidth / commutatorContainer.clientHeight;
        commutatorCamera.updateProjectionMatrix();
        commutatorRenderer.setSize(commutatorContainer.clientWidth, commutatorContainer.clientHeight);
    }
}

// UI Control functions
function updateForceArrow() {
    if (appState.is2DFallback) {
        const forceMagnitude = fieldStrengthValue * currentValue * wireLengthValue;
        const forceElement = document.getElementById('forceMagnitude');
        const directionElement = document.getElementById('forceDirection');
        
        if (forceElement) forceElement.textContent = forceMagnitude.toFixed(2);
        if (directionElement) directionElement.textContent = '↑';
        return;
    }
    
    if (!isSimulationRunning && forceArrow) {
        const forceMagnitude = fieldStrengthValue * currentValue * wireLengthValue;
        
        let displayForce;
        if (forceMagnitude <= 0) {
            displayForce = 0;
        } else if (forceMagnitude < 100) {
            displayForce = forceMagnitude / 50;
        } else {
            displayForce = 2 + Math.log10(forceMagnitude / 10);
        }
        
        displayForce = Math.min(Math.max(displayForce, 0.2), 6);
        forceArrow.setLength(displayForce, 0.4, 0.2);
        
        const hue = 0.6 - (Math.min(forceMagnitude / 10000, 0.6));
        forceArrow.setColor(new THREE.Color().setHSL(hue, 1, 0.5));
    }
}

function toggleSimulation() {
    isSimulationRunning = !isSimulationRunning;
    const startBtn = document.getElementById('start-btn');
    
    if (isSimulationRunning) {
        startBtn.innerHTML = '<span>▶</span> Running...';
        startBtn.style.background = 'linear-gradient(to right, #00db7f, #00b370)';
    } else {
        startBtn.innerHTML = '<span>▶</span> Start Simulation';
        startBtn.style.background = 'linear-gradient(to right, #00b4db, #0083b0)';
        if (forceArrow) forceArrow.scale.set(1, 1, 1);
    }
    
    updateForceArrow();
}

// Calculator functions
function calculateForceAdvanced() {
    const bValue = parseFloat(document.getElementById('magneticField').value);
    const iValue = parseFloat(document.getElementById('currentInput').value);
    const lValue = parseFloat(document.getElementById('length').value);
    const angle = parseFloat(document.getElementById('angle').value);
    
    const bUnit = document.getElementById('bUnit').value;
    const iUnit = document.getElementById('iUnit').value;
    const lUnit = document.getElementById('lUnit').value;

    const unitConversions = {
        magneticField: {
            'T': 1,
            'mT': 0.001,
        },
        current: {
            'A': 1,
            'mA': 0.001
        },
        length: {
            'm': 1,
            'cm': 0.01,
            'mm': 0.001
        }
    };

    // Check if any required fields are empty
    if (isNaN(bValue) || isNaN(iValue) || isNaN(lValue) || isNaN(angle)) {
        const forceValue = document.getElementById('forceValue');
        if (forceValue) {
            forceValue.textContent = 'Enter values in all fields to calculate force';
            forceValue.style.color = '#ff9800';
        }
        const calculationSteps = document.getElementById('calculationSteps');
        if (calculationSteps) calculationSteps.textContent = '';
        return;
    }

    // Allow zero values (they just result in zero force)
    if (bValue < 0 || iValue < 0 || lValue < 0) {
        const forceValue = document.getElementById('forceValue');
        if (forceValue) {
            forceValue.textContent = 'Values cannot be negative';
            forceValue.style.color = '#dc3545';
        }
        const calculationSteps = document.getElementById('calculationSteps');
        if (calculationSteps) calculationSteps.textContent = '';
        return;
    }

    const bBase = bValue * unitConversions.magneticField[bUnit];
    const iBase = iValue * unitConversions.current[iUnit];
    const lBase = lValue * unitConversions.length[lUnit];
    
    const angleRad = angle * (Math.PI / 180);
    
    const force = bBase * iBase * lBase * Math.sin(angleRad);
    
    const forceValue = document.getElementById('forceValue');
    if (forceValue) {
        if (force === 0) {
            forceValue.textContent = 'Force = 0 N';
        } else if (force < 1e-6) {
            forceValue.textContent = `Force = ${force.toExponential(4)} N`;
        } else if (force < 0.01) {
            forceValue.textContent = `Force = ${(force * 1000).toFixed(6)} mN`;
        } else if (force < 1) {
            forceValue.textContent = `Force = ${(force * 1000).toFixed(4)} mN`;
        } else {
            forceValue.textContent = `Force = ${force.toFixed(4)} N`;
        }
        
        forceValue.style.color = '#28a745';
    }
    
    const calculationSteps = document.getElementById('calculationSteps');
    if (calculationSteps) {
        calculationSteps.innerHTML = `
            <strong>Calculation Steps:</strong><br>
            B = ${bValue} ${bUnit} = ${bBase.toExponential(4)} T<br>
            I = ${iValue} ${iUnit} = ${iBase.toExponential(4)} A<br>
            L = ${lValue} ${lUnit} = ${lBase.toExponential(4)} m<br>
            θ = ${angle}° (sinθ = ${Math.sin(angleRad).toFixed(4)})<br>
            F = B × I × L × sinθ = ${force.toExponential(4)} N
        `;
    }
}

function resetCalculatorAdvanced() {
    const magneticFieldInput = document.getElementById('magneticField');
    const currentInput = document.getElementById('currentInput');
    const lengthInput = document.getElementById('length');
    const angleInput = document.getElementById('angle');
    
    if (magneticFieldInput) magneticFieldInput.value = '';
    if (currentInput) currentInput.value = '';
    if (lengthInput) lengthInput.value = '';
    if (angleInput) angleInput.value = '90';
    
    const bUnit = document.getElementById('bUnit');
    const iUnit = document.getElementById('iUnit');
    const lUnit = document.getElementById('lUnit');
    
    if (bUnit) bUnit.value = 'T';
    if (iUnit) iUnit.value = 'A';
    if (lUnit) lUnit.value = 'm';
    
    const forceValue = document.getElementById('forceValue');
    if (forceValue) {
        forceValue.textContent = 'Force will be displayed here';
        forceValue.style.color = '#28a745';
    }
    
    const calculationSteps = document.getElementById('calculationSteps');
    if (calculationSteps) calculationSteps.textContent = '';
}

// Save/Load system
function saveConfiguration(name) {
    try {
        const configuration = {
            id: Date.now().toString(),
            name: name,
            date: new Date().toISOString(),
            motorEffect: {
                current: currentValue,
                fieldStrength: fieldStrengthValue,
                wireLength: wireLengthValue,
                isRunning: isSimulationRunning
            },
            commutator: {
                currentStrength: parseFloat(document.getElementById('current-strength').value),
                magneticField: parseFloat(document.getElementById('magnetic-field').value),
                coilTurns: parseFloat(document.getElementById('coil-turns').value),
                isRotating: isCommutatorRotating,
                rotationDirection: rotationDirection
            }
        };
        
        appState.savedConfigurations.unshift(configuration);
        
        // Keep only last 20 configurations to prevent storage issues
        if (appState.savedConfigurations.length > 20) {
            appState.savedConfigurations = appState.savedConfigurations.slice(0, 20);
        }
        
        appState.lastUsedConfig = configuration.id;
        
        saveToLocalStorage();
        displaySavedConfigurations();
        
        showNotification(`Configuration "${name}" saved successfully!`, '#4CAF50');
    } catch (error) {
        console.error('Save failed:', error);
        showNotification('Save failed: ' + error.message, '#ff416c');
    }
}

function loadConfiguration(config) {
    try {
        // Load motor effect settings
        if (config.motorEffect) {
            document.getElementById('current').value = config.motorEffect.current;
            document.getElementById('field-strength').value = config.motorEffect.fieldStrength;
            document.getElementById('wire-length').value = config.motorEffect.wireLength;
            
            currentValue = config.motorEffect.current;
            fieldStrengthValue = config.motorEffect.fieldStrength;
            wireLengthValue = config.motorEffect.wireLength;
            
            document.getElementById('current-value').textContent = config.motorEffect.current;
            document.getElementById('field-strength-value').textContent = config.motorEffect.fieldStrength;
            document.getElementById('wire-length-value').textContent = config.motorEffect.wireLength;
            
            isSimulationRunning = config.motorEffect.isRunning || false;
            
            const startBtn = document.getElementById('start-btn');
            if (isSimulationRunning) {
                startBtn.innerHTML = '<span>▶</span> Running...';
                startBtn.style.background = 'linear-gradient(to right, #00db7f, #00b370)';
            } else {
                startBtn.innerHTML = '<span>▶</span> Start Simulation';
                startBtn.style.background = 'linear-gradient(to right, #00b4db, #0083b0)';
            }
            
            if (!appState.is2DFallback) {
                createMagneticField();
                createWire();
                updateForceArrow();
            }
        }
        
        // Load commutator settings
        if (config.commutator && !appState.is2DFallback) {
            document.getElementById('current-strength').value = config.commutator.currentStrength || 50;
            document.getElementById('magnetic-field').value = config.commutator.magneticField || 50;
            document.getElementById('coil-turns').value = config.commutator.coilTurns || 50;
            
            currentStrength = (config.commutator.currentStrength || 50) / 100;
            magneticFieldStrength = (config.commutator.magneticField || 50) / 100;
            coilTurns = (config.commutator.coilTurns || 50) / 100;
            isCommutatorRotating = config.commutator.isRotating || false;
            rotationDirection = config.commutator.rotationDirection || 1;
            
            document.getElementById('current-strength-value').textContent = (config.commutator.currentStrength || 50) + '%';
            document.getElementById('magnetic-field-value').textContent = (config.commutator.magneticField || 50) + '%';
            document.getElementById('coil-turns-value').textContent = (config.commutator.coilTurns || 50) + '%';
            
            const rotateBtn = document.getElementById('rotate-btn');
            if (isCommutatorRotating) {
                rotateBtn.innerHTML = '<span>⟳</span> Rotating...';
                rotateBtn.style.background = 'linear-gradient(to right, #4CAF50, #2E7D32)';
            } else {
                rotateBtn.innerHTML = '<span>⟳</span> Rotate Commutator';
                rotateBtn.style.background = 'linear-gradient(to right, #ff9800, #ff5722)';
            }
            
            document.getElementById('reverse-btn').innerHTML = '<span>↔</span> Reverse Current';
            
            if (commutatorScene) {
                createGCSETextbookCommutator();
            }
            
            if (isCommutatorRotating && brushPositive && brushNegative) {
                const rotationAngle = rotatingParts ? rotatingParts.rotation.y % (Math.PI * 2) : 0;
                updateBrushContact(rotationAngle);
            }
        }
        
        showSection('motorEffect');
        showNotification(`Loaded configuration "${config.name}"`, '#2196F3');
    } catch (error) {
        console.error('Load failed:', error);
        showNotification('Load failed: ' + error.message, '#ff416c');
    }
}

// Local storage functions
function saveToLocalStorage() {
    try {
        const data = {
            configurations: appState.savedConfigurations,
            lastUsed: appState.lastUsedConfig,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('motorEffectConfigs', JSON.stringify(data));
    } catch (e) {
        console.warn('Could not save to localStorage:', e);
        showNotification('Could not save to browser storage. Try clearing some space.', '#ff9800');
    }
}

function loadSavedConfigurations() {
    try {
        const saved = localStorage.getItem('motorEffectConfigs');
        if (saved) {
            const data = JSON.parse(saved);
            appState.savedConfigurations = data.configurations || [];
            appState.lastUsedConfig = data.lastUsed;
        }
    } catch (e) {
        console.warn('Could not load from localStorage:', e);
    }
}

// UI Management functions
function hideStartupScreen() {
    const startupScreen = document.getElementById('startupScreen');
    const mainContent = document.getElementById('mainContent');
    
    startupScreen.classList.add('hidden');
    setTimeout(() => {
        startupScreen.style.display = 'none';
        mainContent.style.display = 'block';
        
        checkWebGLAvailability();
        
        if (!appState.is2DFallback) {
            init();
        }
        
        loadSavedConfigurations();
        displaySavedConfigurations();
        
        // Auto-load last used configuration
        if (appState.lastUsedConfig && appState.savedConfigurations.length > 0) {
            const lastConfig = appState.savedConfigurations.find(c => c.id === appState.lastUsedConfig);
            if (lastConfig) {
                setTimeout(() => {
                    loadConfiguration(lastConfig);
                    showNotification(`Welcome back! Loaded your last configuration: "${lastConfig.name}"`);
                }, 1000);
            }
        }
        
        document.getElementById('motorEffectSection').style.display = 'flex';
        document.getElementById('calculatorSection').style.display = 'none';
        document.getElementById('commutatorSection').style.display = 'none';
        document.getElementById('theorySection').style.display = 'none';
        document.getElementById('saveLoadSection').style.display = 'none';
        
    }, 500);
}

function showSection(section) {
    const sections = ['motorEffectSection', 'calculatorSection', 'commutatorSection', 'theorySection', 'saveLoadSection'];
    
    sections.forEach(sectionId => {
        const element = document.getElementById(sectionId);
        if (element) element.style.display = 'none';
    });
    
    switch (section) {
        case 'motorEffect':
            document.getElementById('motorEffectSection').style.display = 'flex';
            appState.currentSection = 'motorEffect';
            break;
        case 'calculator':
            document.getElementById('calculatorSection').style.display = 'block';
            appState.currentSection = 'calculator';
            // Trigger calculation if all fields have values
            calculateForceAdvanced();
            break;
        case 'commutator':
            document.getElementById('commutatorSection').style.display = 'block';
            appState.currentSection = 'commutator';
            if (!window.commutatorInitialized && !appState.is2DFallback) {
                setTimeout(() => {
                    initCommutator();
                    window.commutatorInitialized = true;
                }, 100);
            }
            break;
        case 'theory':
            document.getElementById('theorySection').style.display = 'block';
            appState.currentSection = 'theory';
            break;
        case 'saveLoad':
            document.getElementById('saveLoadSection').style.display = 'block';
            appState.currentSection = 'saveLoad';
            displaySavedConfigurations();
            break;
    }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function displaySavedConfigurations() {
    const savedConfigsList = document.getElementById('savedConfigsList');
    if (!savedConfigsList) return;
    
    savedConfigsList.innerHTML = '';
    
    if (appState.savedConfigurations.length === 0) {
        savedConfigsList.innerHTML = `
            <div style="text-align: center; padding: 30px; color: #aaa;">
                No saved configurations yet. Save your first configuration to see it here!
            </div>
        `;
        return;
    }
    
    appState.savedConfigurations.forEach(config => {
        const configElement = document.createElement('div');
        configElement.className = 'saved-config';
        configElement.innerHTML = `
            <div class="saved-config-header">
                <div class="saved-config-name">${escapeHtml(config.name)}</div>
                <div class="saved-config-date">${new Date(config.date).toLocaleDateString()}</div>
            </div>
            <div style="font-size: 0.9rem; opacity: 0.8;">
                Motor: ${config.motorEffect.current}A, ${config.motorEffect.fieldStrength}T, ${config.motorEffect.wireLength}m
            </div>
            <div class="saved-config-actions">
                <button class="config-action-btn load" data-id="${config.id}">Load</button>
                <button class="config-action-btn export" data-id="${config.id}">Export</button>
                <button class="config-action-btn delete" data-id="${config.id}">Delete</button>
            </div>
        `;
        savedConfigsList.appendChild(configElement);
    });
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function closeSaveModal() {
    const saveModal = document.getElementById('saveModal');
    const configNameInput = document.getElementById('configNameInput');
    
    if (saveModal) saveModal.classList.remove('active');
    if (configNameInput) configNameInput.value = '';
}

// Notification system
function showNotification(message, color = '#00b4db') {
    const existingNotification = document.querySelector('.floating-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = 'floating-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(to right, ${color}, ${color}99);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-weight: 600;
        box-shadow: 0 5px 15px ${color}66;
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Event handler setup
function setupEventHandlers() {
    // Startup screen buttons
    eventDelegator.register('gotoMotorEffect', () => {
        hideStartupScreen();
        showNotification('Motor Effect Simulation loaded');
    });
    
    eventDelegator.register('gotoCommutator', () => {
        hideStartupScreen();
        showSection('commutator');
    });
    
    eventDelegator.register('gotoCalculator', () => {
        hideStartupScreen();
        showSection('calculator');
    });
    
    eventDelegator.register('gotoTheory', () => {
        hideStartupScreen();
        showSection('theory');
    });
    
    eventDelegator.register('skipToMain', hideStartupScreen);
    
    // Navigation buttons
    eventDelegator.register('navMotorEffect', () => showSection('motorEffect'));
    eventDelegator.register('navCommutator', () => showSection('commutator'));
    eventDelegator.register('navCalculator', () => showSection('calculator'));
    eventDelegator.register('navTheory', () => showSection('theory'));
    eventDelegator.register('navSaveLoad', () => showSection('saveLoad'));
    
    // Motor effect controls
    eventDelegator.register('current', (e) => {
        currentValue = parseFloat(e.target.value);
        document.getElementById('current-value').textContent = currentValue;
        
        if (!appState.is2DFallback && wire) {
            wire.material.emissiveIntensity = Math.min(currentValue / 50, 0.8);
        }
        
        if (isSimulationRunning) updateForceArrow();
    });
    
    eventDelegator.register('field-strength', (e) => {
        fieldStrengthValue = parseFloat(e.target.value);
        document.getElementById('field-strength-value').textContent = fieldStrengthValue;
        
        if (!appState.is2DFallback) {
            createMagneticField();
        }
        
        if (isSimulationRunning) updateForceArrow();
    });
    
    eventDelegator.register('wire-length', (e) => {
        wireLengthValue = parseFloat(e.target.value);
        document.getElementById('wire-length-value').textContent = wireLengthValue;
        
        if (!appState.is2DFallback) {
            createWire();
        }
        
        if (isSimulationRunning) updateForceArrow();
    });
    
    eventDelegator.register('start-btn', toggleSimulation);
    
    eventDelegator.register('pause-btn', () => {
        isSimulationRunning = false;
        const startBtn = document.getElementById('start-btn');
        startBtn.innerHTML = '<span>▶</span> Start Simulation';
        startBtn.style.background = 'linear-gradient(to right, #00b4db, #0083b0)';
        if (forceArrow) forceArrow.scale.set(1, 1, 1);
    });
    
    eventDelegator.register('reset-btn', () => {
        isSimulationRunning = false;
        document.getElementById('current').value = 5;
        document.getElementById('field-strength').value = 5;
        document.getElementById('wire-length').value = 10;
        
        currentValue = 5;
        fieldStrengthValue = 5;
        wireLengthValue = 10;
        
        document.getElementById('current-value').textContent = '5';
        document.getElementById('field-strength-value').textContent = '5';
        document.getElementById('wire-length-value').textContent = '10';
        
        const startBtn = document.getElementById('start-btn');
        startBtn.innerHTML = '<span>▶</span> Start Simulation';
        startBtn.style.background = 'linear-gradient(to right, #00b4db, #0083b0)';
        
        if (!appState.is2DFallback) {
            createMagneticField();
            createWire();
            createForceArrow();
            if (controls) controls.reset();
        }
        
        showNotification('Values reset to defaults!', '#00b4db');
    });
    
    // Commutator controls
    eventDelegator.register('current-strength', (e) => {
        currentStrength = parseFloat(e.target.value) / 100;
        document.getElementById('current-strength-value').textContent = e.target.value + '%';
        if (commutatorScene) {
            createGCSETextbookCommutator();
        }
    });
    
    eventDelegator.register('magnetic-field', (e) => {
        magneticFieldStrength = parseFloat(e.target.value) / 100;
        document.getElementById('magnetic-field-value').textContent = e.target.value + '%';
        if (commutatorScene) {
            createGCSETextbookCommutator();
        }
    });
    
    eventDelegator.register('coil-turns', (e) => {
        coilTurns = parseFloat(e.target.value) / 100;
        document.getElementById('coil-turns-value').textContent = e.target.value + '%';
        if (commutatorScene) {
            createGCSETextbookCommutator();
        }
    });
    
    eventDelegator.register('rotate-btn', () => {
        isCommutatorRotating = !isCommutatorRotating;
        const rotateBtn = document.getElementById('rotate-btn');
        
        if (isCommutatorRotating) {
            rotateBtn.innerHTML = '<span>⟳</span> Rotating...';
            rotateBtn.style.background = 'linear-gradient(to right, #4CAF50, #2E7D32)';
            showNotification('Commutator rotation started');
        } else {
            rotateBtn.innerHTML = '<span>⟳</span> Rotate Commutator';
            rotateBtn.style.background = 'linear-gradient(to right, #ff9800, #ff5722)';
            showNotification('Commutator rotation stopped');
        }
    });
    
    eventDelegator.register('reverse-btn', () => {
        rotationDirection *= -1;
        const reverseBtn = document.getElementById('reverse-btn');
        reverseBtn.innerHTML = '<span>↔</span> Reverse Current';
        
        showNotification('Current direction reversed');
    });
    
    eventDelegator.register('stop-commutator-btn', () => {
        isCommutatorRotating = false;
        const rotateBtn = document.getElementById('rotate-btn');
        rotateBtn.innerHTML = '<span>⟳</span> Rotate Commutator';
        rotateBtn.style.background = 'linear-gradient(to right, #ff9800, #ff5722)';
        
        if (brushPositive) brushPositive.material.emissive.setHex(0x000000);
        if (brushNegative) brushNegative.material.emissive.setHex(0x000000);
        
        showNotification('Commutator rotation stopped');
    });
    
    eventDelegator.register('reset-commutator-btn', () => {
        document.getElementById('current-strength').value = 50;
        document.getElementById('magnetic-field').value = 50;
        document.getElementById('coil-turns').value = 50;
        
        currentStrength = 0.5;
        magneticFieldStrength = 0.5;
        coilTurns = 0.5;
        isCommutatorRotating = false;
        rotationDirection = 1;
        
        document.getElementById('current-strength-value').textContent = '50%';
        document.getElementById('magnetic-field-value').textContent = '50%';
        document.getElementById('coil-turns-value').textContent = '50%';
        
        const rotateBtn = document.getElementById('rotate-btn');
        rotateBtn.innerHTML = '<span>⟳</span> Rotate Commutator';
        rotateBtn.style.background = 'linear-gradient(to right, #ff9800, #ff5722)';
        
        document.getElementById('reverse-btn').innerHTML = '<span>↔</span> Reverse Current';
        
        if (commutatorScene) {
            createGCSETextbookCommutator();
        }
        
        showNotification('Commutator reset to default settings');
    });
    
    // Save/Load system
    eventDelegator.register('saveCurrentBtn', () => {
        const configNameInput = document.getElementById('configNameInput');
        const saveModal = document.getElementById('saveModal');
        
        configNameInput.value = `Config ${appState.savedConfigurations.length + 1}`;
        saveModal.classList.add('active');
        configNameInput.focus();
    });
    
    eventDelegator.register('confirmSaveBtn', () => {
        const configNameInput = document.getElementById('configNameInput');
        const name = configNameInput.value.trim();
        
        if (name) {
            saveConfiguration(name);
            closeSaveModal();
        } else {
            showNotification('Please enter a configuration name', '#ff9800');
        }
    });
    
    eventDelegator.register('cancelSaveBtn', closeSaveModal);
    
    eventDelegator.register('loadDefaultBtn', () => {
        loadConfiguration(defaultConfig);
        showNotification('Loaded default configuration');
    });
    
    eventDelegator.register('clearAllBtn', () => {
        if (confirm('Are you sure you want to delete ALL saved configurations? This cannot be undone.')) {
            appState.savedConfigurations = [];
            appState.lastUsedConfig = null;
            saveToLocalStorage();
            displaySavedConfigurations();
            showNotification('All configurations cleared');
        }
    });
    
    eventDelegator.register('exportConfigBtn', () => {
        const currentConfig = {
            id: 'export-' + Date.now(),
            name: `Export-${new Date().toISOString().slice(0,10)}`,
            date: new Date().toISOString(),
            motorEffect: {
                current: currentValue,
                fieldStrength: fieldStrengthValue,
                wireLength: wireLengthValue,
                isRunning: isSimulationRunning
            },
            commutator: {
                currentStrength: parseFloat(document.getElementById('current-strength').value),
                magneticField: parseFloat(document.getElementById('magnetic-field').value),
                coilTurns: parseFloat(document.getElementById('coil-turns').value),
                isRotating: isCommutatorRotating,
                rotationDirection: rotationDirection
            }
        };
        
        exportConfiguration(currentConfig);
    });
    
    eventDelegator.register('importConfigBtn', () => {
        document.getElementById('importFileInput').click();
    });
    
    // Scroll to top
    eventDelegator.register('scrollToTopBtn', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    // Window scroll for scroll-to-top button
    window.addEventListener('scroll', () => {
        const scrollToTopBtn = document.getElementById('scrollToTopBtn');
        if (scrollToTopBtn) {
            scrollToTopBtn.style.display = window.pageYOffset > 300 ? 'flex' : 'none';
        }
    });
    
    // Delegated event handlers for saved config actions
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('config-action-btn')) {
            const configId = target.getAttribute('data-id');
            const config = appState.savedConfigurations.find(c => c.id === configId);
            
            if (!config) return;
            
            if (target.classList.contains('load')) {
                loadConfiguration(config);
            } else if (target.classList.contains('export')) {
                exportConfiguration(config);
            } else if (target.classList.contains('delete')) {
                if (confirm(`Delete configuration "${config.name}"?`)) {
                    appState.savedConfigurations = appState.savedConfigurations.filter(c => c.id !== configId);
                    if (appState.lastUsedConfig === configId) {
                        appState.lastUsedConfig = null;
                    }
                    saveToLocalStorage();
                    displaySavedConfigurations();
                    showNotification(`Configuration "${config.name}" deleted`);
                }
            }
        }
    });
    
    // Auto-save before unload
    window.addEventListener('beforeunload', () => {
        if (appState.savedConfigurations.length > 0) {
            saveToLocalStorage();
        }
        
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        
        memoryManager.clearAll();
    });
    
    // Import file input change handler
    document.getElementById('importFileInput').addEventListener('change', importConfiguration);
}

// Calculator reset button handler
eventDelegator.register('resetAdvancedBtn', resetCalculatorAdvanced);

// Initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log("GCSE Physics Motor Effect Simulation loaded");
    
    eventDelegator.setupGlobalListeners();
    setupEventHandlers();
    
    // Add animation styles if not present
    if (!document.querySelector('#animations')) {
        const style = document.createElement('style');
        style.id = 'animations';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
});

// Global exports for debugging
window.MotorEffectSimulation = {
    appState,
    memoryManager,
    eventDelegator,
    init,
    initCommutator,
    saveConfiguration,
    loadConfiguration,
    exportConfiguration,
    showSection,
    showNotification
};

console.log("Motor Effect Simulation v2.0 - Enhanced Edition loaded");