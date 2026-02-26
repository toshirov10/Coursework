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
        rotationSpeed: 100,
        coilAngle: 0,
        currentStrength: 50,
        magneticField: 50,
        isRotating: false,
        rotationDirection: 1
    },
    calculator: {
        f: '',
        q: '',
        v: '',
        b: ''
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
        
        // Process cleanup queue
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
let currentValue = 0;
let fieldStrengthValue = 0;
let wireLengthValue = 0;
let isSimulationRunning = false;

// Commutator variables
let commutatorScene, commutatorCamera, commutatorRenderer, commutatorControls;
let stationaryMagnets, rotatingParts, coil, splitRing;
let brushPositive, brushNegative;
let isCommutatorRotating = false;
let rotationDirection = 1;
let rotationSpeed = 1.0;
let coilAngle = 0;
let currentStrength = 0.5;
let magneticFieldStrength = 0.5;

// Animation frame ID for cleanup
let animationFrameId = null;

// Event delegation section

class EventDelegator {
    constructor() {
        this.handlers = new Map();
    }

    setupGlobalListeners() {
        // Single click handler for all buttons
        document.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;

            const id = target.id;
            const handlers = this.handlers.get(id);
            
            if (handlers) {
                handlers.forEach(handler => handler(e));
            }
        });

        // Single input handler for all sliders
        document.addEventListener('input', (e) => {
            if (e.target.type === 'range') {
                const id = e.target.id;
                const handlers = this.handlers.get(id);
                
                if (handlers) {
                    handlers.forEach(handler => handler(e));
                }
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Space to toggle simulation
            if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                toggleSimulation();
            }
            
            // Escape to close modal
            if (e.code === 'Escape') {
                const modal = document.getElementById('saveModal');
                if (modal.classList.contains('active')) {
                    closeSaveModal();
                }
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

// Webgl detection and fallback

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
    // Create 2D representation of motor effect
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

// 3D Simulation functions with memory management

function init() {
    if (appState.is2DFallback) return;
    
    console.log("Initializing 3D simulation...");
    
    try {
        // Create scene for motor effect
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
        
        // Add optimized lights
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
    
    // Create optimized magnetic poles with fewer polygons
    const poleGeometry = memoryManager.register(new THREE.BoxGeometry(0.8, 0.8, 0.8));
    const northMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xff0000,
        emissive: 0x660000,
        emissiveIntensity: 0.3
    }));
    const southMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0x0000ff,
        emissive: 0x000066,
        emissiveIntensity: 0.3
    }));
    
    const northPole = memoryManager.register(new THREE.Mesh(poleGeometry, northMaterial));
    const southPole = memoryManager.register(new THREE.Mesh(poleGeometry, southMaterial));
    northPole.position.set(0, 0, -2);
    southPole.position.set(0, 0, 2);
    
    magneticField.add(northPole, southPole);
    
    // Reduced number of field lines for performance
    for (let i = -1; i <= 1; i += 0.8) {
        for (let j = -1; j <= 1; j += 0.8) {
            const fieldLine = memoryManager.register(new THREE.ArrowHelper(
                new THREE.Vector3(0, 0, 1),
                new THREE.Vector3(i, j, -1.5),
                3, 0x00ff00, 0.4, 0.2
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
    
    const displayLength = wireLengthValue / 5;
    const wireGeometry = memoryManager.register(new THREE.CylinderGeometry(0.08, 0.08, displayLength, 12)); // Reduced segments
    const wireMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.2
    }));
    
    wire = memoryManager.register(new THREE.Mesh(wireGeometry, wireMaterial));
    wire.rotation.x = Math.PI / 2;
    wire.position.y = 0.5;
    
    const currentDirection = memoryManager.register(new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-displayLength / 2, 0.5, 0),
        0.8, 0xff6600, 0.3, 0.15
    ));
    wire.add(currentDirection);
    
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

// Optimised animation loop

let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000 / 60; // 60 FPS

function animate(currentTime = 0) {
    animationFrameId = requestAnimationFrame(animate);
    
    // Throttle updates for performance
    const deltaTime = currentTime - lastUpdateTime;
    if (deltaTime < UPDATE_INTERVAL) return;
    
    lastUpdateTime = currentTime;
    
    // Update motor effect simulation
    if (scene && camera && renderer) {
        controls.update();
        
        if (isSimulationRunning) {
            const forceMagnitude = fieldStrengthValue * currentValue * wireLengthValue;
            const displayForce = Math.min(forceMagnitude / 500, 5);
            
            if (forceArrow) {
                forceArrow.setLength(displayForce, 0.4, 0.2);
                const pulse = 1 + 0.2 * Math.sin(currentTime * 0.003);
                forceArrow.scale.set(pulse, pulse, pulse);
            }
        }
        
        renderer.render(scene, camera);
    }
    
    // Update commutator simulation
    if (commutatorScene && commutatorCamera && commutatorRenderer) {
        if (commutatorControls) commutatorControls.update();
        
        if (isCommutatorRotating && rotatingParts) {
            rotatingParts.rotation.y += 0.02 * rotationDirection * rotationSpeed;
            const rotationAngle = rotatingParts.rotation.y % (Math.PI * 2);
            updateBrushContact(rotationAngle);
        }
        
        commutatorRenderer.render(commutatorScene, commutatorCamera);
    }
    
    // Periodic memory cleanup
    if (currentTime % 5000 < 16) { // Every ~5 seconds
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
    // Clean up existing objects
    if (stationaryMagnets) {
        memoryManager.queueForCleanup(stationaryMagnets);
        commutatorScene.remove(stationaryMagnets);
    }
    if (rotatingParts) {
        memoryManager.queueForCleanup(rotatingParts);
        commutatorScene.remove(rotatingParts);
    }
    
    // Create stationary magnets group
    stationaryMagnets = memoryManager.register(new THREE.Group());
    
    // Create magnetic poles with optimized geometry
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
    
    // Create rotating parts group
    rotatingParts = memoryManager.register(new THREE.Group());
    
    // Create rotating coil
    coil = memoryManager.register(new THREE.Group());
    const coilWidth = 1.6;
    const coilHeight = 2.2;
    const wireThickness = 0.1;
    
    const coilMaterial = memoryManager.register(new THREE.MeshPhongMaterial({
        color: 0xffff00,
        emissive: 0xffff00,
        emissiveIntensity: 0.4 * currentStrength
    }));
    
    // Create coil sides with shared geometry
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
    
    // Add connections to split ring
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
    coil.rotation.y = coilAngle * (Math.PI / 180);
    rotatingParts.add(coil);
    
    // Create split ring commutator
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
    
    // Add shaft
    const shaftGeometry = memoryManager.register(new THREE.CylinderGeometry(0.1, 0.1, 5, 8));
    const shaftMaterial = memoryManager.register(new THREE.MeshPhongMaterial({ color: 0x888888 }));
    const shaft = memoryManager.register(new THREE.Mesh(shaftGeometry, shaftMaterial));
    shaft.rotation.x = Math.PI / 2;
    rotatingParts.add(shaft);
    
    // Create brushes
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
    
    // Add current flow particles
    createCurrentFlowIndicators();
    
    // Add both groups to the scene
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
    const dataStr = JSON.stringify(config, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `motor-effect-config-${new Date().toISOString().slice(0,10)}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    showNotification('Configuration exported successfully!');
}

function importConfiguration(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const config = JSON.parse(e.target.result);
            if (validateConfiguration(config)) {
                loadConfiguration(config);
                showNotification('Configuration imported successfully!');
            } else {
                showNotification('Invalid configuration file', '#ff416c');
            }
        } catch (error) {
            showNotification('Error reading configuration file', '#ff416c');
        }
    };
    reader.readAsText(file);
}

function validateConfiguration(config) {
    return config &&
           config.motorEffect &&
           typeof config.motorEffect.current === 'number' &&
           typeof config.motorEffect.fieldStrength === 'number' &&
           typeof config.motorEffect.wireLength === 'number';
}

// Utitlity functions

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
    
    const forceMagnitude = fieldStrengthValue * currentValue * wireLengthValue;
    const displayForce = Math.min(forceMagnitude / 500, 5);
    if (forceArrow) {
        forceArrow.setLength(displayForce, 0.4, 0.2);
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
    const iValue = parseFloat(document.getElementById('current').value);
    const lValue = parseFloat(document.getElementById('length').value);
    const angle = parseFloat(document.getElementById('angle').value);
    
    // Get selected units
    const bUnit = document.getElementById('bUnit').value;
    const iUnit = document.getElementById('iUnit').value;
    const lUnit = document.getElementById('lUnit').value;

    // Unit conversion factors
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

    // Validate inputs
    if (isNaN(bValue) || isNaN(iValue) || isNaN(lValue) || isNaN(angle)) {
        const forceValue = document.getElementById('forceValue');
        if (forceValue) {
            forceValue.textContent = 'Please enter valid numbers for all fields';
            forceValue.style.color = '#dc3545';
        }
        const calculationSteps = document.getElementById('calculationSteps');
        if (calculationSteps) calculationSteps.textContent = '';
        return;
    }

    if (bValue <= 0 || iValue <= 0 || lValue <= 0) {
        const forceValue = document.getElementById('forceValue');
        if (forceValue) {
            forceValue.textContent = 'Values must be positive numbers';
            forceValue.style.color = '#dc3545';
        }
        const calculationSteps = document.getElementById('calculationSteps');
        if (calculationSteps) calculationSteps.textContent = '';
        return;
    }

    // Convert to base units (Tesla, Amperes, Meters)
    const bBase = bValue * unitConversions.magneticField[bUnit];
    const iBase = iValue * unitConversions.current[iUnit];
    const lBase = lValue * unitConversions.length[lUnit];
    
    // Convert angle to radians for sine calculation
    const angleRad = angle * (Math.PI / 180);
    
    // Calculate force using F = BILsinθ
    const force = bBase * iBase * lBase * Math.sin(angleRad);
    
    // Display results
    const forceValue = document.getElementById('forceValue');
    if (forceValue) {
        if (force < 1e-6) {
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
    
    // Show calculation steps
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

function calculateForceSimple() {
    const f = parseFloat(document.getElementById('f').value);
    const q = parseFloat(document.getElementById('q').value);
    const v = parseFloat(document.getElementById('v').value);
    const b = parseFloat(document.getElementById('b').value);
    
    const values = [f, q, v, b];
    const emptyCount = values.filter(val => isNaN(val)).length;
    
    if (emptyCount !== 1) {
        alert('Please leave exactly one field empty to calculate.');
        return;
    }
    
    let result;
    if (isNaN(f)) {
        result = q * v * b;
        document.getElementById('f').value = result.toFixed(2);
    } else if (isNaN(q)) {
        result = f / (v * b);
        document.getElementById('q').value = result.toFixed(2);
    } else if (isNaN(v)) {
        result = f / (q * b);
        document.getElementById('v').value = result.toFixed(2);
    } else if (isNaN(b)) {
        result = f / (q * v);
        document.getElementById('b').value = result.toFixed(2);
    }
}

function resetCalculatorAdvanced() {
    const magneticFieldInput = document.getElementById('magneticField');
    const currentInput = document.getElementById('current');
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

function resetCalculatorSimple() {
    document.getElementById('f').value = '';
    document.getElementById('q').value = '';
    document.getElementById('v').value = '';
    document.getElementById('b').value = '';
}

// Save/Load system

function saveConfiguration(name) {
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
            rotationSpeed: parseFloat(document.getElementById('rotation-speed').value),
            coilAngle: parseFloat(document.getElementById('coil-angle').value),
            currentStrength: parseFloat(document.getElementById('current-strength').value),
            magneticField: parseFloat(document.getElementById('magnetic-field').value),
            isRotating: isCommutatorRotating,
            rotationDirection: rotationDirection
        },
        calculator: {
            f: document.getElementById('f') ? document.getElementById('f').value : '',
            q: document.getElementById('q') ? document.getElementById('q').value : '',
            v: document.getElementById('v') ? document.getElementById('v').value : '',
            b: document.getElementById('b') ? document.getElementById('b').value : ''
        }
    };
    
    appState.savedConfigurations.unshift(configuration);
    appState.lastUsedConfig = configuration.id;
    
    saveToLocalStorage();
    displaySavedConfigurations();
    
    showNotification(`Configuration "${name}" saved successfully!`);
}

function loadConfiguration(config) {
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
            createWire();
            updateForceArrow();
        }
    }
    
    // Load commutator settings
    if (config.commutator && !appState.is2DFallback) {
        document.getElementById('rotation-speed').value = config.commutator.rotationSpeed;
        document.getElementById('coil-angle').value = config.commutator.coilAngle;
        document.getElementById('current-strength').value = config.commutator.currentStrength;
        document.getElementById('magnetic-field').value = config.commutator.magneticField;
        
        rotationSpeed = config.commutator.rotationSpeed / 100;
        coilAngle = config.commutator.coilAngle;
        currentStrength = config.commutator.currentStrength / 100;
        magneticFieldStrength = config.commutator.magneticField / 100;
        isCommutatorRotating = config.commutator.isRotating || false;
        rotationDirection = config.commutator.rotationDirection || 1;
        
        document.getElementById('rotation-speed-value').textContent = config.commutator.rotationSpeed + '%';
        document.getElementById('coil-angle-value').textContent = config.commutator.coilAngle + '°';
        document.getElementById('current-strength-value').textContent = config.commutator.currentStrength + '%';
        document.getElementById('magnetic-field-value').textContent = config.commutator.magneticField + '%';
        
        const rotateBtn = document.getElementById('rotate-btn');
        if (isCommutatorRotating) {
            rotateBtn.innerHTML = '<span>⟳</span> Rotating...';
            rotateBtn.style.background = 'linear-gradient(to right, #4CAF50, #2E7D32)';
        } else {
            rotateBtn.innerHTML = '<span>⟳</span> Rotate Commutator';
            rotateBtn.style.background = 'linear-gradient(to right, #ff9800, #ff5722)';
        }
        
        document.getElementById('reverse-btn').innerHTML = rotationDirection > 0 
            ? '<span>↔</span> Clockwise' 
            : '<span>↔</span> Counterclockwise';
        
        if (commutatorScene) {
            createGCSETextbookCommutator();
        }
        
        if (isCommutatorRotating && brushPositive && brushNegative) {
            const rotationAngle = rotatingParts ? rotatingParts.rotation.y % (Math.PI * 2) : 0;
            updateBrushContact(rotationAngle);
        }
    }
    
    // Load calculator settings
    if (config.calculator) {
        if (document.getElementById('f')) document.getElementById('f').value = config.calculator.f || '';
        if (document.getElementById('q')) document.getElementById('q').value = config.calculator.q || '';
        if (document.getElementById('v')) document.getElementById('v').value = config.calculator.v || '';
        if (document.getElementById('b')) document.getElementById('b').value = config.calculator.b || '';
    }
    
    showSection('motorEffect');
}

// Local storage function

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
            
            if (appState.lastUsedConfig && appState.savedConfigurations.length > 0) {
                const lastConfig = appState.savedConfigurations.find(c => c.id === appState.lastUsedConfig);
                if (lastConfig) {
                    setTimeout(() => {
                        loadConfiguration(lastConfig);
                        showNotification(`Welcome back! Loaded your last configuration: "${lastConfig.name}"`);
                    }, 1000);
                }
            }
        }
    } catch (e) {
        console.warn('Could not load from localStorage:', e);
    }
}

// UI Management function

function hideStartupScreen() {
    const startupScreen = document.getElementById('startupScreen');
    const mainContent = document.getElementById('mainContent');
    
    startupScreen.classList.add('hidden');
    setTimeout(() => {
        startupScreen.style.display = 'none';
        mainContent.style.display = 'block';
        
        // Check WebGL before initializing
        checkWebGLAvailability();
        
        if (!appState.is2DFallback) {
            init();
        }
        
        loadSavedConfigurations();
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
    showNotification(`Switched to ${section.replace(/([A-Z])/g, ' $1').trim()} section`);
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
                <div class="saved-config-name">${config.name}</div>
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

function closeSaveModal() {
    const saveModal = document.getElementById('saveModal');
    const configNameInput = document.getElementById('configNameInput');
    
    if (saveModal) saveModal.classList.remove('active');
    if (configNameInput) configNameInput.value = '';
}

// Notification system

function showNotification(message, color = '#00b4db') {
    // Remove existing notification if it exists
    const existingNotification = document.querySelector('.floating-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create a notification element
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
    
    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// Event handler function

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
        if (isSimulationRunning) updateForceArrow();
    });
    
    eventDelegator.register('field-strength', (e) => {
        fieldStrengthValue = parseFloat(e.target.value);
        document.getElementById('field-strength-value').textContent = fieldStrengthValue;
        if (isSimulationRunning) updateForceArrow();
    });
    
    eventDelegator.register('wire-length', (e) => {
        wireLengthValue = parseFloat(e.target.value);
        document.getElementById('wire-length-value').textContent = wireLengthValue;
        if (!appState.is2DFallback) createWire();
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
        document.getElementById('current').value = 0;
        document.getElementById('field-strength').value = 0;
        document.getElementById('wire-length').value = 0;
        
        currentValue = 0;
        fieldStrengthValue = 0;
        wireLengthValue = 0;
        
        document.getElementById('current-value').textContent = '0';
        document.getElementById('field-strength-value').textContent = '0';
        document.getElementById('wire-length-value').textContent = '0';
        
        const startBtn = document.getElementById('start-btn');
        startBtn.innerHTML = '<span>▶</span> Start Simulation';
        startBtn.style.background = 'linear-gradient(to right, #00b4db, #0083b0)';
        
        if (!appState.is2DFallback) {
            createWire();
            createForceArrow();
            if (controls) controls.reset();
        }
        
        showNotification('All values reset to 0!', '#ff416c');
    });
    
    // Commutator controls
    eventDelegator.register('rotation-speed', (e) => {
        rotationSpeed = parseFloat(e.target.value) / 100;
        document.getElementById('rotation-speed-value').textContent = e.target.value + '%';
    });
    
    eventDelegator.register('coil-angle', (e) => {
        coilAngle = parseFloat(e.target.value);
        document.getElementById('coil-angle-value').textContent = e.target.value + '°';
        if (rotatingParts) rotatingParts.rotation.y = coilAngle * (Math.PI / 180);
    });
    
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
        reverseBtn.innerHTML = rotationDirection > 0 
            ? '<span>↔</span> Clockwise' 
            : '<span>↔</span> Counterclockwise';
        
        showNotification(rotationDirection > 0 
            ? 'Direction changed to Clockwise' 
            : 'Direction changed to Counterclockwise');
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
        document.getElementById('rotation-speed').value = 100;
        document.getElementById('coil-angle').value = 0;
        document.getElementById('current-strength').value = 50;
        document.getElementById('magnetic-field').value = 50;
        
        rotationSpeed = 1.0;
        coilAngle = 0;
        currentStrength = 0.5;
        magneticFieldStrength = 0.5;
        isCommutatorRotating = false;
        rotationDirection = 1;
        
        document.getElementById('rotation-speed-value').textContent = '100%';
        document.getElementById('coil-angle-value').textContent = '0°';
        document.getElementById('current-strength-value').textContent = '50%';
        document.getElementById('magnetic-field-value').textContent = '50%';
        
        const rotateBtn = document.getElementById('rotate-btn');
        rotateBtn.innerHTML = '<span>⟳</span> Rotate Commutator';
        rotateBtn.style.background = 'linear-gradient(to right, #ff9800, #ff5722)';
        
        document.getElementById('reverse-btn').innerHTML = '<span>↔</span> Clockwise';
        
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
            saveToLocalStorage();
            displaySavedConfigurations();
            showNotification('All configurations cleared');
        }
    });
    
    // Export button 
    const exportBtn = document.createElement('button');
    exportBtn.className = 'save-load-btn';
    exportBtn.id = 'exportConfigBtn';
    exportBtn.innerHTML = '📤 Export Current';
    const saveLoadControls = document.querySelector('.save-load-controls');
    if (saveLoadControls) {
        saveLoadControls.appendChild(exportBtn);
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
                    rotationSpeed: parseFloat(document.getElementById('rotation-speed').value),
                    coilAngle: parseFloat(document.getElementById('coil-angle').value),
                    currentStrength: parseFloat(document.getElementById('current-strength').value),
                    magneticField: parseFloat(document.getElementById('magnetic-field').value),
                    isRotating: isCommutatorRotating,
                    rotationDirection: rotationDirection
                },
                calculator: {
                    f: document.getElementById('f') ? document.getElementById('f').value : '',
                    q: document.getElementById('q') ? document.getElementById('q').value : '',
                    v: document.getElementById('v') ? document.getElementById('v').value : '',
                    b: document.getElementById('b') ? document.getElementById('b').value : ''
                }
            };
            
            exportConfiguration(currentConfig);
        });
    }
    
    // Import function
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.json';
    importInput.style.display = 'none';
    importInput.id = 'importFileInput';
    document.body.appendChild(importInput);
    
    const importBtn = document.createElement('button');
    importBtn.className = 'save-load-btn load';
    importBtn.id = 'importConfigBtn';
    importBtn.innerHTML = '📥 Import Configuration';
    if (saveLoadControls) {
        saveLoadControls.appendChild(importBtn);
        eventDelegator.register('importConfigBtn', () => {
            document.getElementById('importFileInput').click();
        });
    }
    
    importInput.addEventListener('change', importConfiguration);
    
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
                showNotification(`Loaded configuration "${config.name}"`);
            } else if (target.classList.contains('export')) {
                exportConfiguration(config);
            } else if (target.classList.contains('delete')) {
                if (confirm(`Delete configuration "${config.name}"?`)) {
                    appState.savedConfigurations = appState.savedConfigurations.filter(c => c.id !== configId);
                    saveToLocalStorage();
                    displaySavedConfigurations();
                    showNotification(`Configuration "${config.name}" deleted`);
                }
            }
        }
    });
    
    // Calculator enter key support for simple calculator
    const simpleCalculatorInputs = document.querySelectorAll('.horizontal-calculator input');
    if (simpleCalculatorInputs.length > 0) {
        simpleCalculatorInputs.forEach(input => {
            input.addEventListener('keyup', function(e) {
                if (e.key === 'Enter') calculateForceSimple();
            });
        });
    }
    
    // Auto-save before unload
    window.addEventListener('beforeunload', () => {
        if (appState.savedConfigurations.length > 0) {
            saveToLocalStorage();
        }
        
        // Clean up animation frame
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        
        // Clean up Three.js resources
        memoryManager.clearAll();
    });
}

// Accessibility improvements

function enhanceAccessibility() {
    // Add ARIA labels to all interactive elements
    const elements = [
        { selector: '#gotoMotorEffect', label: 'Go to Motor Effect Simulation' },
        { selector: '#gotoCommutator', label: 'Go to Split Ring Commutator' },
        { selector: '#gotoCalculator', label: 'Go to Force Calculator' },
        { selector: '#gotoTheory', label: 'Go to Physics Theory' },
        { selector: '#skipToMain', label: 'Skip to Main Interface' },
        { selector: '#navMotorEffect', label: 'Navigate to Motor Effect' },
        { selector: '#navCommutator', label: 'Navigate to Commutator' },
        { selector: '#navCalculator', label: 'Navigate to Calculator' },
        { selector: '#navTheory', label: 'Navigate to Theory' },
        { selector: '#navSaveLoad', label: 'Navigate to Save/Load' },
        { selector: '#start-btn', label: 'Start Simulation' },
        { selector: '#pause-btn', label: 'Pause Simulation' },
        { selector: '#reset-btn', label: 'Reset to Zero' },
        { selector: '#rotate-btn', label: 'Rotate Commutator' },
        { selector: '#reverse-btn', label: 'Reverse Direction' },
        { selector: '#stop-commutator-btn', label: 'Stop Rotation' },
        { selector: '#reset-commutator-btn', label: 'Reset Sliders' },
        { selector: '#saveCurrentBtn', label: 'Save Current Configuration' },
        { selector: '#loadDefaultBtn', label: 'Load Default Configuration' },
        { selector: '#clearAllBtn', label: 'Clear All Saved Configurations' }
    ];
    
    elements.forEach(({ selector, label }) => {
        const element = document.querySelector(selector);
        if (element) {
            element.setAttribute('aria-label', label);
        }
    });
    
    // Add role attributes
    document.querySelectorAll('button').forEach(btn => {
        btn.setAttribute('role', 'button');
    });
    
    // Add keyboard navigation hints
    document.querySelectorAll('.startup-btn, .nav-btn, .sim-btn, .commutator-btn').forEach(btn => {
        btn.setAttribute('tabindex', '0');
    });
}

// Calculator event handlers

// Simple calculator (F = QvB) event handlers
eventDelegator.register('calculateSimpleBtn', calculateForceSimple);
eventDelegator.register('resetSimpleBtn', resetCalculatorSimple);

// Advanced calculator (F = BILsinθ) event handlers  
eventDelegator.register('calculateAdvancedBtn', calculateForceAdvanced);
eventDelegator.register('resetAdvancedBtn', resetCalculatorAdvanced);

// Update the showSection function to show both calculators
const originalShowSection = window.showSection;
window.showSection = function(section) {
    originalShowSection(section);
    
    // Also hide/show the advanced calculator
    const advancedCalc = document.getElementById('advancedCalculatorSection');
    const simpleCalc = document.getElementById('calculatorSection');
    
    if (section === 'calculator') {
        if (advancedCalc) advancedCalc.style.display = 'block';
        if (simpleCalc) simpleCalc.style.display = 'block';
    }
};

// Calculator tab switching

function setupCalculatorTabs() {
    const tabs = document.querySelectorAll('.calculator-tab');
    const contents = document.querySelectorAll('.calculator-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all tabs and contents
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const calcType = tab.getAttribute('data-calc');
            document.getElementById(`${calcType}CalculatorContent`).classList.add('active');
        });
    });
}

// Add calculator tab switching to event delegation
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('calculator-tab')) {
        // Remove active class from all tabs
        document.querySelectorAll('.calculator-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Remove active class from all contents
        document.querySelectorAll('.calculator-content').forEach(content => {
            content.classList.remove('active');
        });
        
        // Add active class to clicked tab
        e.target.classList.add('active');
        
        // Show corresponding content
        const calcType = e.target.getAttribute('data-calc');
        document.getElementById(`${calcType}CalculatorContent`).classList.add('active');
    }
});

// Initilising

document.addEventListener('DOMContentLoaded', function() {
    console.log("GCSE Physics Motor Effect Simulation loaded");
    
    // Setup event handlers
    eventDelegator.setupGlobalListeners();
    setupEventHandlers();
    
    // Setup calculator tabs
    setupCalculatorTabs();
    
    // Enhance accessibility
    enhanceAccessibility();
    
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
    
    // Setup advanced calculator event listeners if it exists
    const calculateBtn = document.getElementById('calculateBtn');
    const resetBtn = document.getElementById('resetBtn');
    
    if (calculateBtn && resetBtn) {
        calculateBtn.addEventListener('click', calculateForceAdvanced);
        resetBtn.addEventListener('click', resetCalculatorAdvanced);
        
        // Add real-time calculation on input change
        const inputs = ['magneticField', 'current', 'length', 'angle'];
        inputs.forEach(inputId => {
            const input = document.getElementById(inputId);
            if (input) {
                input.addEventListener('input', function() {
                    if (document.getElementById('magneticField').value && 
                        document.getElementById('current').value && 
                        document.getElementById('length').value && 
                        document.getElementById('angle').value) {
                        calculateForceAdvanced();
                    }
                });
            }
        });
        
        // Add unit change listeners
        ['bUnit', 'iUnit', 'lUnit'].forEach(unitId => {
            const unitSelect = document.getElementById(unitId);
            if (unitSelect) {
                unitSelect.addEventListener('change', function() {
                    if (document.getElementById('magneticField').value || 
                        document.getElementById('current').value || 
                        document.getElementById('length').value) {
                        calculateForceAdvanced();
                    }
                });
            }
        });
    }

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