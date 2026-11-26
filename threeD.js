
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js';

// ================================================
// VIRTUAL WELDING SIMULATOR
// JOINT TYPES + ANGLE CONTROL + WELDING EFFECTS
// ================================================

const $ = id => document.getElementById(id);

const container = $('scene-container');
const statusText = $('status');
const startButton = $('startPractice');
const resetButton = $('resetPractice');
const angleSlider = $('angleSlider');
const angleValue = $('angleValue');
const angleNote = $('angleNote');
const jointSelector = $('jointType');

if (!container || !statusText || !startButton || !resetButton ||
    !angleSlider || !angleValue || !angleNote || !jointSelector) {
    throw new Error('Simulator setup error: check the HTML element IDs.');
}

// SETTINGS
const plateWidth = 5.2;
const plateDepth = 0.95;
const thickness = 0.12;
const seamY = 0.15;
const sectionCount = 50;
const particleCount = 130;

let selectedAngle = Number(angleSlider.value) || 90;
let selectedJoint = jointSelector.value || 'butt';
let isPracticing = false;
let isDragging = false;
let lastSampleTime = 0;
let lastBeadPoint = null;
let accuracySamples = [];

const sectionDone = new Array(sectionCount).fill(false);

// SCENE
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101d2d);
scene.fog = new THREE.Fog(0x101d2d, 12, 27);

const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
);
camera.position.set(6.5, 5.4, 8.5);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.55, 0);
controls.minDistance = 5;
controls.maxDistance = 15;
controls.maxPolarAngle = Math.PI * 0.48;

// LIGHTS
scene.add(new THREE.HemisphereLight(0xbad9ff, 0x253040, 2));

const mainLight = new THREE.DirectionalLight(0xffffff, 2.2);
mainLight.position.set(4, 9, 5);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(1024, 1024);
scene.add(mainLight);

const blueLight = new THREE.PointLight(0x168bff, 18, 12);
blueLight.position.set(-4, 3, -3);
scene.add(blueLight);

// MATERIALS
const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x18283a,
    roughness: 0.82,
    metalness: 0.2
});

const metalMaterial = new THREE.MeshStandardMaterial({
    color: 0x75899c,
    metalness: 0.82,
    roughness: 0.32
});

const darkMetalMaterial = new THREE.MeshStandardMaterial({
    color: 0x26394c,
    metalness: 0.75,
    roughness: 0.42
});

const seamMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd52a,
    emissive: 0x8a5700,
    emissiveIntensity: 0.65
});

// WORKSHOP
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    floorMaterial
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.12;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(24, 24, 0x3b617e, 0x29445d);
grid.position.y = -0.105;
scene.add(grid);

const tableTop = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 0.22, 3.6),
    darkMetalMaterial
);
tableTop.position.set(0, -0.02, 0);
tableTop.castShadow = true;
tableTop.receiveShadow = true;
scene.add(tableTop);

const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x35495d,
    metalness: 0.75,
    roughness: 0.45
});

for (const x of [-2.8, 2.8]) {
    for (const z of [-1.45, 1.45]) {
        const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 1.4, 0.18),
            legMaterial
        );
        leg.position.set(x, -0.82, z);
        leg.castShadow = true;
        scene.add(leg);
    }
}

// JOINT MODEL
const jointGroup = new THREE.Group();
scene.add(jointGroup);

let platePivot = null;
let targetLine = null;
let targetMarkers = [];

function makePlate(width, height, depth) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        metalMaterial
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x9bb6c9 })
    );
    mesh.add(edges);

    return mesh;
}

function addTargetLine(y, z) {
    targetLine = new THREE.Mesh(
        new THREE.BoxGeometry(plateWidth, 0.014, 0.035),
        seamMaterial
    );
    targetLine.position.set(0, y, z);
    jointGroup.add(targetLine);

    targetMarkers = [];

    for (let i = 0; i <= 20; i++) {
        const marker = new THREE.Mesh(
            new THREE.BoxGeometry(0.018, 0.016, 0.13),
            new THREE.MeshBasicMaterial({ color: 0xffed8a })
        );
        marker.position.set(-2.5 + i * 0.25, y + 0.008, z);
        jointGroup.add(marker);
        targetMarkers.push(marker);
    }
}

function buildJoint(type) {
    jointGroup.clear();
    platePivot = null;
    targetLine = null;
    targetMarkers = [];

    const baseY = seamY - thickness / 2;

    if (type === 'butt') {
        // Two plates meet edge-to-edge.
        const plateA = makePlate(plateWidth, thickness, plateDepth);
        plateA.position.set(0, baseY, -plateDepth / 2);
        jointGroup.add(plateA);

        platePivot = new THREE.Group();
        platePivot.position.set(0, seamY, 0);
        jointGroup.add(platePivot);

        const plateB = makePlate(plateWidth, thickness, plateDepth);
        plateB.position.set(0, -thickness / 2, plateDepth / 2);
        platePivot.add(plateB);

        addTargetLine(seamY + 0.012, 0);
    }

    if (type === 'tee') {
        // Horizontal base with a vertical plate.
        const base = makePlate(plateWidth, thickness, plateDepth);
        base.position.set(0, baseY, 0);
        jointGroup.add(base);

        const upright = makePlate(
            plateWidth,
            plateDepth,
            thickness
        );
        upright.position.set(0, seamY + plateDepth / 2, 0);
        jointGroup.add(upright);

        addTargetLine(seamY + 0.012, 0);
    }

    if (type === 'lap') {
        // Two overlapping horizontal plates.
        const lower = makePlate(plateWidth, thickness, plateDepth);
        lower.position.set(0, baseY, -0.25);
        jointGroup.add(lower);

        const upper = makePlate(plateWidth, thickness, plateDepth);
        upper.position.set(0, seamY + thickness / 2, 0.25);
        jointGroup.add(upper);

        addTargetLine(seamY + thickness + 0.015, -0.23);
    }

    if (type === 'corner') {
        // Horizontal plate and upright plate meeting at an edge.
        const horizontal = makePlate(
            plateWidth,
            thickness,
            plateDepth
        );
        horizontal.position.set(0, baseY, -plateDepth / 2);
        jointGroup.add(horizontal);

        platePivot = new THREE.Group();
        platePivot.position.set(0, seamY, 0);
        jointGroup.add(platePivot);

        const upright = makePlate(
            plateWidth,
            plateDepth,
            thickness
        );
        upright.position.set(
            0,
            plateDepth / 2,
            -thickness / 2
        );
        platePivot.add(upright);

        addTargetLine(seamY + 0.012, 0);
    }

    updateAngle(selectedAngle);
}

// ANGLE CONTROL
function updateAngle(angle) {
    selectedAngle = THREE.MathUtils.clamp(
        Math.round(Number(angle)),
        0,
        180
    );

    if (platePivot) {
        const rotation = 180 - selectedAngle;
        platePivot.rotation.x =
            -THREE.MathUtils.degToRad(rotation);
    }

    angleSlider.value = String(selectedAngle);
    angleValue.textContent = `${selectedAngle}°`;

    if (selectedAngle === 90) {
        angleNote.textContent = 'Right-angle joint selected.';
    } else if (selectedAngle === 180) {
        angleNote.textContent = 'Flat joint angle selected.';
    } else {
        angleNote.textContent = `Custom ${selectedAngle}° angle selected.`;
    }
}

buildJoint(selectedJoint);

// TORCH
const torch = new THREE.Group();
torch.position.set(-2.3, 1.17, 0);
scene.add(torch);

const torchBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x263e58,
    metalness: 0.72,
    roughness: 0.28
});

const handleMaterial = new THREE.MeshStandardMaterial({
    color: 0x101820,
    metalness: 0.25,
    roughness: 0.7
});

const copperMaterial = new THREE.MeshStandardMaterial({
    color: 0xd17b38,
    metalness: 0.85,
    roughness: 0.22
});

const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105, 0.14, 0.58, 20),
    handleMaterial
);
handle.position.y = 0.1;
handle.rotation.z = -0.18;
torch.add(handle);

const torchBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.11, 0.38, 20),
    torchBodyMaterial
);
torchBody.position.y = 0.48;
torchBody.rotation.z = -0.18;
torch.add(torchBody);

const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.105, 0.43, 16),
    copperMaterial
);
neck.position.set(0, -0.29, 0);
torch.add(neck);

const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.075, 0.27, 16),
    new THREE.MeshStandardMaterial({
        color: 0xb8c6d1,
        metalness: 0.95,
        roughness: 0.18
    })
);
nozzle.position.set(0, -0.64, 0);
torch.add(nozzle);

const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 0.12, 16),
    copperMaterial
);
tip.position.set(0, -0.83, 0);
torch.add(tip);

const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8a24,
    transparent: true,
    opacity: 0.85
});

const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 20, 20),
    glowMaterial
);
glow.position.set(0, -0.91, 0);
glow.visible = false;
torch.add(glow);

const weldingLight = new THREE.PointLight(0xff7b18, 0, 2.5);
weldingLight.position.set(0, -0.91, 0);
torch.add(weldingLight);

const torchHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 12),
    new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false
    })
);
torchHitbox.position.set(0, 0.12, 0);
torch.add(torchHitbox);

// WELD BEAD
const beadGroup = new THREE.Group();
scene.add(beadGroup);

const beadMaterial = new THREE.MeshStandardMaterial({
    color: 0x9ba8b2,
    metalness: 0.88,
    roughness: 0.3,
    emissive: 0x25170e,
    emissiveIntensity: 0.15
});

const beadGeometry = new THREE.CylinderGeometry(
    0.047, 0.047, 1, 10, 1
);

function addBeadSegment(start, end) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();

    if (length < 0.025) return;

    const bead = new THREE.Mesh(beadGeometry, beadMaterial);
    bead.position.copy(start).add(end).multiplyScalar(0.5);
    bead.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize()
    );
    bead.scale.set(1, length, 1);
    beadGroup.add(bead);
}

// SPARK PARTICLES
const particlePositions = new Float32Array(particleCount * 3);
const particleVelocities = [];
const particleAges = new Float32Array(particleCount);

for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3 + 1] = -100;
    particleVelocities.push(new THREE.Vector3());
}

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(particlePositions, 3)
);

const particleMaterial = new THREE.PointsMaterial({
    color: 0xffa12e,
    size: 0.075,
    transparent: true,
    opacity: 0.95,
    sizeAttenuation: true
});

const sparks = new THREE.Points(particleGeometry, particleMaterial);
scene.add(sparks);

let nextParticle = 0;

function emitSparks(position) {
    for (let i = 0; i < 5; i++) {
        const index = nextParticle;
        nextParticle = (nextParticle + 1) % particleCount;
        const offset = index * 3;

        particlePositions[offset] = position.x;
        particlePositions[offset + 1] = position.y;
        particlePositions[offset + 2] = position.z;

        particleVelocities[index].set(
            (Math.random() - 0.5) * 2.3,
            0.8 + Math.random() * 2.2,
            (Math.random() - 0.5) * 2.3
        );

        particleAges[index] = 0.35 + Math.random() * 0.4;
    }

    particleGeometry.attributes.position.needsUpdate = true;
}

function updateSparks(delta) {
    for (let i = 0; i < particleCount; i++) {
        if (particleAges[i] <= 0) continue;

        particleAges[i] -= delta;
        const offset = i * 3;

        particleVelocities[i].y -= 3.8 * delta;

        particlePositions[offset] += particleVelocities[i].x * delta;
        particlePositions[offset + 1] += particleVelocities[i].y * delta;
        particlePositions[offset + 2] += particleVelocities[i].z * delta;

        if (
            particleAges[i] <= 0 ||
            particlePositions[offset + 1] < 0
        ) {
            particlePositions[offset + 1] = -100;
            particleAges[i] = 0;
        }
    }

    particleGeometry.attributes.position.needsUpdate = true;
}

// POINTER AND TORCH MOVEMENT
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const weldingPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    -seamY
);
const pointerPoint = new THREE.Vector3();
const torchTipWorld = new THREE.Vector3();

function getTorchTip() {
    torch.getWorldPosition(torchTipWorld);
    torchTipWorld.y = seamY + 0.025;
    return torchTipWorld;
}

function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    if (raycaster.ray.intersectPlane(weldingPlane, pointerPoint)) {
        torch.position.x = THREE.MathUtils.clamp(
            pointerPoint.x, -2.55, 2.55
        );

        torch.position.z = THREE.MathUtils.clamp(
            pointerPoint.z, -0.55, 0.55
        );
    }
}

function stopDragging() {
    isDragging = false;
    controls.enabled = true;
    lastBeadPoint = null;
}

renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;

    const rect = renderer.domElement.getBoundingClientRect();

    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObject(torch, true);

    if (hits.length > 0) {
        isDragging = true;
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        updatePointer(event);
        event.preventDefault();
    }
});

renderer.domElement.addEventListener('pointermove', event => {
    if (isDragging) updatePointer(event);
});

renderer.domElement.addEventListener('pointerup', stopDragging);
renderer.domElement.addEventListener('pointercancel', stopDragging);
renderer.domElement.addEventListener('lostpointercapture', stopDragging);

// RESULTS PANEL
const resultsPanel = document.querySelector('.results-panel');

if (!resultsPanel) {
    throw new Error('Simulator setup error: results panel is missing.');
}

resultsPanel.innerHTML = `
    <h3>Practice Results</h3>
    <div class="results-grid">
        <div class="result-card">
            <span class="result-label">Weld Completion</span>
            <span class="result-value" id="score">0%</span>
            <div class="progress-track">
                <div class="progress-fill" id="scoreProgress"></div>
            </div>
        </div>
        <div class="result-card">
            <span class="result-label">Alignment Accuracy</span>
            <span class="result-value" id="accuracy">0%</span>
            <div class="progress-track">
                <div class="progress-fill" id="accuracyProgress"></div>
            </div>
        </div>
    </div>
    <p id="practiceStatus">Ready to begin!</p>
`;

const scoreText = $('score');
const accuracyText = $('accuracy');
const practiceStatus = $('practiceStatus');
const scoreProgress = $('scoreProgress');
const accuracyProgress = $('accuracyProgress');

// PAUSE BUTTON
const pauseButton = document.createElement('button');
pauseButton.id = 'pausePractice';
pauseButton.textContent = 'Pause Practice';
pauseButton.type = 'button';
pauseButton.disabled = true;
startButton.parentElement.appendChild(pauseButton);

// RESULTS
function updateResults() {
    const completed = sectionDone.filter(Boolean).length;
    const score = Math.round((completed / sectionCount) * 100);

    let accuracy = 0;

    if (accuracySamples.length > 0) {
        const averageError = accuracySamples.reduce(
            (sum, value) => sum + value,
            0
        ) / accuracySamples.length;

        accuracy = Math.max(
            0,
            Math.round(100 - averageError * 180)
        );
    }

    scoreText.textContent = `${score}%`;
    accuracyText.textContent = `${accuracy}%`;
    scoreProgress.style.width = `${score}%`;
    accuracyProgress.style.width = `${accuracy}%`;

    if (completed === sectionCount) {
        practiceStatus.textContent = 'Practice completed! Review your results.';
    } else if (isPracticing) {
        practiceStatus.textContent =
            `Practice in progress: ${completed} of ${sectionCount} sections completed.`;
    } else {
        practiceStatus.textContent = 'Ready to begin! Select Start Practice and move the torch along the target line.';
    }
}

// RESET DATA
function clearPracticeData() {
    sectionDone.fill(false);
    accuracySamples = [];
    lastBeadPoint = null;
    lastSampleTime = 0;
    beadGroup.clear();

    for (let i = 0; i < particleCount; i++) {
        particlePositions[i * 3 + 1] = -100;
        particleAges[i] = 0;
        particleVelocities[i].set(0, 0, 0);
    }

    particleGeometry.attributes.position.needsUpdate = true;
}

// JOINT SELECTION
jointSelector.addEventListener('change', () => {
    selectedJoint = jointSelector.value;

    isPracticing = false;
    isDragging = false;
    controls.enabled = true;

    clearPracticeData();
    buildJoint(selectedJoint);

    torch.position.set(-2.3, 1.17, 0);
    glow.visible = false;
    weldingLight.intensity = 0;

    pauseButton.disabled = true;
    pauseButton.textContent = 'Pause Practice';

    const names = {
        butt: 'Butt Joint',
        tee: 'T-Joint',
        lap: 'Lap Joint',
        corner: 'Corner Joint'
    };

    statusText.textContent =
        `${names[selectedJoint]} selected. Ready to practice.`;

    updateResults();
});

// ANGLE SLIDER
angleSlider.addEventListener('input', () => {
    updateAngle(angleSlider.value);

    isPracticing = false;
    isDragging = false;
    controls.enabled = true;

    clearPracticeData();

    torch.position.set(-2.3, 1.17, 0);
    glow.visible = false;
    weldingLight.intensity = 0;

    pauseButton.disabled = true;
    pauseButton.textContent = 'Pause Practice';

    statusText.textContent =
        `Joint angle changed to ${selectedAngle}°. Ready for practice.`;

    updateResults();
});

// START
startButton.addEventListener('click', () => {
    isPracticing = true;
    lastBeadPoint = null;
    lastSampleTime = 0;

    statusText.textContent =
        `Practice active: ${selectedJoint} joint, ${selectedAngle}°.`;

    pauseButton.disabled = false;
    pauseButton.textContent = 'Pause Practice';

    updateResults();
});

// PAUSE AND RESUME
pauseButton.addEventListener('click', () => {
    isPracticing = !isPracticing;

    if (isPracticing) {
        pauseButton.textContent = 'Pause Practice';
        statusText.textContent = 'Practice resumed.';
    } else {
        pauseButton.textContent = 'Resume Practice';
        statusText.textContent = 'Practice paused.';
        lastBeadPoint = null;
    }

    updateResults();
});

// RESET
resetButton.addEventListener('click', () => {
    isPracticing = false;
    isDragging = false;
    controls.enabled = true;

    clearPracticeData();

    torch.position.set(-2.3, 1.17, 0);
    glow.visible = false;
    weldingLight.intensity = 0;

    pauseButton.disabled = true;
    pauseButton.textContent = 'Pause Practice';

    statusText.textContent = 'Workshop reset. Ready for a new practice session.';

    updateResults();
});

// HELP
const help = document.createElement('p');
help.className = 'simulator-help';
help.textContent =
    'Select a joint type and angle. Start practice and drag the torch along the yellow target line. Drag the empty workshop area to rotate the camera and use the mouse wheel to zoom.';

container.insertAdjacentElement('afterend', help);

// ANIMATION
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.04);
    const animationTime = clock.elapsedTime;

    controls.update();

    const tipPosition = getTorchTip();

    if (isPracticing && isDragging) {
        glow.visible = true;

        glow.material.opacity =
            0.65 + Math.sin(animationTime * 18) * 0.2;

        glow.scale.setScalar(
            0.85 + Math.sin(animationTime * 22) * 0.16
        );

        weldingLight.intensity =
            4.5 + Math.sin(animationTime * 25) * 1.4;

        const now = performance.now();

        if (now - lastSampleTime >= 35) {
            lastSampleTime = now;

            const distanceFromSeam = Math.abs(tipPosition.z);

            if (distanceFromSeam <= 0.24) {
                const section = Math.floor(
                    ((tipPosition.x + 2.6) / 5.2) * sectionCount
                );

                const safeSection = THREE.MathUtils.clamp(
                    section, 0, sectionCount - 1
                );

                accuracySamples.push(distanceFromSeam);

                const currentPoint = new THREE.Vector3(
                    tipPosition.x,
                    seamY + 0.045,
                    tipPosition.z
                );

                if (lastBeadPoint) {
                    const movement = currentPoint.distanceTo(lastBeadPoint);

                    if (movement > 0.025 && movement < 0.6) {
                        addBeadSegment(lastBeadPoint, currentPoint);
                    }
                }

                lastBeadPoint = currentPoint.clone();
                sectionDone[safeSection] = true;

                emitSparks(new THREE.Vector3(
                    tipPosition.x,
                    seamY + 0.08,
                    tipPosition.z
                ));

                updateResults();
            } else {
                lastBeadPoint = null;
            }
        }
    } else {
        glow.visible = false;
        weldingLight.intensity = 0;
        lastBeadPoint = null;
    }

    updateSparks(delta);
    renderer.render(scene, camera);
}

animate();

// RESIZE
function resizeScene() {
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (!width || !height) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

const resizeObserver = new ResizeObserver(resizeScene);
resizeObserver.observe(container);

window.addEventListener('beforeunload', () => {
    resizeObserver.disconnect();
});

// READY
statusText.textContent = '3D Workshop Ready';
updateResults();
