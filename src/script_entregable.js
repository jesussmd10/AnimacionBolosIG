// Importaciones de librerías principales
import * as THREE from "three";
import Ammo from "ammojs-typed"; // Motor de física
import * as TWEEN from "@tweenjs/tween.js"; // Librería para animaciones suaves
// Necesario para leer archivos .glb
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/* --------------------------------------------------
 VARIABLES
-------------------------------------------------- */

// Objetos gráficos base de Three.js
let camera, escena, renderer;

// Variables para el motor de física (Ammo.js)
let mundoFisico; // El "mundo" donde ocurre la simulación (gravedad, colisiones)
let cuerposRigidos = []; // Array para guardar objetos que se mueven
let transformAux; // Variable auxiliar de Ammo para cálculos de posición

// Elementos del juego
let cuerpoBola = null; // La referencia física de la bola (la que choca)
let isBallThrown = false; // Flag para bloquear controles una vez lanzada

let bolos = []; // Array que contiene todos los bolos creados
let flechaDireccion; // El objeto visual 3D de la flecha
let throwAngle = 0; // Ángulo de lanzamiento actual (controlado con A/D)

// Puntuación / UI (Interfaz de Usuario HTML)
let score = 0;
const uiScore = document.getElementById("score");
const uiMsg = document.getElementById("msg");

// Guardamos aquí los modelos "molde" una vez cargados para clonarlos después
let modeloBolo = null;
let modeloBola = null;

// Sonidos
const audioStrike = new Audio("src/sounds/wii-sports-strike.mp3");
const audioGood = new Audio("src/sounds/wii-sports-spare.mp3");
const audioBad = new Audio("src/sounds/wii-sports-bowling-awww.mp3");
const audioThrow = new Audio("src/sounds/bowler-clash-royal.mp3");
// Ajuste de volúmenes
audioThrow.volume = 0.1;
audioStrike.volume = 0.1;
audioGood.volume = 0.1;
audioBad.volume = 0.1;

// Configuración del juego (constantes físicas)
const BALL_RADIUS = 0.8; // Radio de la física de la bola
const PIN_RADIUS = 0.3; // Radio de la física del bolo
const PIN_HEIGHT = 1.5; // Altura del bolo

/* --------------------------------------------------
   INICIO
-------------------------------------------------- */

// Ammo.js es asíncrono debemos esperar a que cargue antes de hacer nada.
Ammo(Ammo).then(start);

function start() {
  // Inicializamos la transformación auxiliar (se usa en el bucle de animación)
  transformAux = new Ammo.btTransform();

  initGraphics(); // Configurar Three.js
  initPhysics(); // Configurar Ammo.js
  initInput(); // Configurar Teclado

  // Primero cargamos los modelos 3D externos. Solo cuando termina (.then), creamos el nivel
  cargarModelos().then(() => {
    createLevel();
    animate();
  });
}

/* --------------------------------------------------
   FUNCIÓN DE CARGA DE MODELOS
-------------------------------------------------- */
function cargarModelos() {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    let cargados = 0;
    const total = 2; // Esperamos 2 cosas: Bolo y Bola

    // Función interna para comprobar si ya terminaron todos
    const checkLoad = () => {
      cargados++;
      if (cargados === total) resolve(); // ¡Listo! Continuamos con el juego
    };

    // --- CARGAR BOLO ---
    loader.load(
      "src/assets/bowling_pin.glb",
      (gltf) => {
        const model = gltf.scene;

        // Depuración y Centrado:
        // Los modelos 3D a veces vienen con el punto de pivote (origen) desplazado
        // Calculamos la caja (Box3) que envuelve al modelo para saber su centro y tamaño real
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        console.log("BOLO CARGADO. Dimensiones originales:", size);

        // Centrar el modelo: Restamos el centro geométrico a su posición.
        // Esto evita que el bolo rote "raro"
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center);

        // Wrapper (Envoltorio):
        // Metemos el modelo en un Grupo vacío. Escalamos y movemos el Grupo, no el modelo crudo
        // Esto protege la geometría original y facilita la gestión
        const wrapper = new THREE.Group();
        wrapper.add(model);

        // Escalado automático:
        // Calculamos cuánto debemos escalar el modelo para que mida exactamente PIN_HEIGHT (1.5).
        if (size.y === 0) {
          wrapper.scale.set(1, 1, 1); // Evitar dividir por 0 si falla la carga
        } else {
          const scaleFactor = PIN_HEIGHT / size.y;
          wrapper.scale.set(scaleFactor, scaleFactor, scaleFactor);
          console.log("Factor de escala aplicado al bolo:", scaleFactor);
        }

        // Sombras y Materiales:
        // Recorremos todos los hijos del modelo para activar sombras y arreglar materiales oscuros.
        wrapper.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            // Si el material viene negro, le damos un poco de brillo (emissive)
            if (c.material) {
              c.material.emissive = new THREE.Color(0x222222);
            }
          }
        });

        modeloBolo = wrapper; // Guardamos el "molde" listo para usar
        checkLoad();
      },
      undefined, // Callback de progreso
      (err) => {
        console.error("Error cargando el bolo:", err);
        checkLoad(); // Resolvemos igual para que el juego no se cuelgue, aunque falle el modelo
      }
    );

    // --- CARGAR BOLA ---
    // (Misma lógica que el bolo: cargar, centrar, escalar y guardar en modeloBola)
    loader.load(
      "src/assets/bowling_ball.glb",
      (gltf) => {
        const model = gltf.scene;

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        console.log("⚪ BOLA CARGADA. Dimensiones:", size);

        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center);

        const wrapper = new THREE.Group();
        wrapper.add(model);

        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim === 0) {
          wrapper.scale.set(1, 1, 1);
        } else {
          // Ajustamos escala para coincidir con BALL_RADIUS * 2 (Diámetro)
          const scaleFactor = (BALL_RADIUS * 2) / maxDim;
          wrapper.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }

        wrapper.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        modeloBola = wrapper;
        checkLoad();
      },
      undefined,
      (err) => {
        console.error("Error cargando la bola:", err);
        checkLoad();
      }
    );
  });
}

/* --------------------------------------------------
   GRÁFICOS Y ENTORNO
-------------------------------------------------- */

function initGraphics() {
  // Escena básica
  escena = new THREE.Scene();
  escena.background = new THREE.Color(0x050510); // Color fondo oscuro

  // Cámara
  camera = new THREE.PerspectiveCamera(
    60, // FOV
    window.innerWidth / window.innerHeight,
    0.2, // Distancia mínima de renderizado
    2000 // Distancia máxima
  );
  camera.position.set(0, 5, 25); // Posición inicial detrás de la pista

  // Renderer (el "motor gráfico")
  renderer = new THREE.WebGLRenderer({ antialias: true }); // Antialias suaviza bordes
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true; // Activar sombras
  document.body.appendChild(renderer.domElement);

  // Iluminación
  const luzAmbiental = new THREE.AmbientLight(0x404040); // Luz base suave
  escena.add(luzAmbiental);

  const luzPrincipal = new THREE.DirectionalLight(0xffffff, 1); // Luz tipo "Sol"
  luzPrincipal.position.set(10, 20, 10);
  luzPrincipal.castShadow = true;
  // Aumentar calidad de sombras
  luzPrincipal.shadow.mapSize.set(2048, 2048);
  escena.add(luzPrincipal);

  const luzNeon = new THREE.PointLight(0x00ffff, 2, 50); // Luz decorativa cyan
  luzNeon.position.set(0, 5, -20);
  escena.add(luzNeon);

  createStars(); // Función auxiliar para crear estrellas de fondo
  window.addEventListener("resize", onWindowResize); // Manejar cambio de tamaño de ventana
}

function createStars() {
  // Crea 1000 puntos blancos aleatorios para simular estrellas
  const starCount = 1000;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < positions.length; i++)
    positions[i] = (Math.random() - 0.5) * 100;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 0.1, color: 0xffffff })
  );
  escena.add(stars);
}

/* --------------------------------------------------
   FÍSICA (AMMO.JS)
-------------------------------------------------- */

function initPhysics() {
  // Configuración estándar de Ammo.js para detectar colisiones
  const config = new Ammo.btDefaultCollisionConfiguration();
  const dispatcher = new Ammo.btCollisionDispatcher(config);
  const broadphase = new Ammo.btDbvtBroadphase(); // Algoritmo para detectar colisiones lejanas
  const solver = new Ammo.btSequentialImpulseConstraintSolver();

  // Crear el mundo físico
  mundoFisico = new Ammo.btDiscreteDynamicsWorld(
    dispatcher,
    broadphase,
    solver,
    config
  );
  // Definir gravedad (negativa en Y)
  mundoFisico.setGravity(new Ammo.btVector3(0, -9.8, 0));
}

/* --------------------------------------------------
   CREAR NIVEL
-------------------------------------------------- */

function createLevel() {
  // Suelo (Pista)
  const floorMat = new THREE.MeshPhongMaterial({
    color: 0x222222,
    shininess: 100, // Efecto pulido de pista de bolos
  });
  createBox(
    new THREE.Vector3(8, 1, 50),
    0, // Masa 0 = no se mueve, es suelo
    new THREE.Vector3(0, -0.5, -10),
    new THREE.Quaternion(),
    floorMat
  );

  // Canaletas
  const bumperMat = new THREE.MeshStandardMaterial({
    color: 0xff00ff,
    emissive: 0xff00ff,
    emissiveIntensity: 0.5,
  });
  // Canaleta izquierda
  createBox(
    new THREE.Vector3(0.5, 1, 49),
    0,
    new THREE.Vector3(-3.5, 0, -10),
    new THREE.Quaternion(),
    bumperMat
  );
  // Canaleta derecha
  createBox(
    new THREE.Vector3(0.5, 1, 49),
    0,
    new THREE.Vector3(3.5, 0, -10),
    new THREE.Quaternion(),
    bumperMat
  );

  // Bolos - Configuración en triángulo
  const pinMat = new THREE.MeshPhongMaterial({ color: 0xffffff }); // Material por defecto si falla el modelo
  const startZ = -25;
  let row = 0;
  // Doble bucle para crear la formación triangular (1, 2, 3, 4 bolos)
  for (let i = 0; i < 4; i++) {
    row++;
    for (let j = 0; j < row; j++) {
      // Cálculo matemático para la posición X y Z
      const x = j * 0.8 - (i * 0.8) / 2;
      const z = startZ - i * 0.8;
      createPin(new THREE.Vector3(x, PIN_HEIGHT / 2, z), pinMat);
    }
  }

  // Bola
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0x00aaff,
    roughness: 0.2,
    metalness: 0.5,
  });
  createBall(new THREE.Vector3(0, 2, 14), ballMat);

  // Flecha direccional
  createArrow();
}

/* --------------------------------------------------
   CREACIÓN DE OBJETOS
-------------------------------------------------- */

function createPin(pos, materialFallback) {
  let mesh;

  // Lógica de Modelo 3D y Fallback
  if (modeloBolo) {
    // .clone(): Copia el modelo base para que cada bolo sea independiente
    mesh = modeloBolo.clone();

    // Clonamos también los materiales internos para poder cambiarles el color
    // individualmente si uno se cae (rojo) y otros no.
    mesh.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        // Guardamos el color original para restaurarlo si el bolo se levanta
        child.material.userData.originalColor = child.material.color.clone();
        // Guardamos referencia fácil al material principal en userData del padre
        mesh.userData.mainMaterial = child.material;
      }
    });
  } else {
    // Si no hay modelo, creamos un Cilindro básico (Fallback)
    const mat = materialFallback.clone();
    mat.userData.originalColor = mat.color.clone();
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(PIN_RADIUS, PIN_RADIUS, PIN_HEIGHT, 16),
      mat
    );
    mesh.userData.mainMaterial = mat;
  }

  mesh.visible = true;
  mesh.castShadow = true;

  // Física: Usamos un Cilindro invisible para calcular los choques
  const shape = new Ammo.btCylinderShape(
    new Ammo.btVector3(PIN_RADIUS, PIN_HEIGHT / 2, PIN_RADIUS)
  );
  const mass = 2; // Masa de 2kg aprox

  createRigidBody(mesh, shape, mass, pos, new THREE.Quaternion());
  bolos.push(mesh);
}

function createBall(pos, materialFallback) {
  let mesh;

  if (modeloBola) {
    // Usar modelo 3D cargado
    mesh = modeloBola.clone();
  } else {
    // Fallback: Esfera simple
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 32, 32),
      materialFallback
    );
  }

  mesh.castShadow = true;

  // Física: siempre una esfera perfecta matemática para que ruede suave
  const shape = new Ammo.btSphereShape(BALL_RADIUS);
  const mass = 15; // Bola pesada (15kg)

  createRigidBody(mesh, shape, mass, pos, new THREE.Quaternion());

  cuerpoBola = mesh.userData.physicsBody;
  // Estado 4 = Disable Deactivation. Evita que la bola se "duerma" (deje de calcular física) antes de lanzar.
  cuerpoBola.setActivationState(4);
}

// Función auxiliar para crear cajas (suelo y paredes)
function createBox(scale, mass, pos, quat, material) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(scale.x, scale.y, scale.z),
    material
  );
  mesh.position.copy(pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Forma física: Caja
  const shape = new Ammo.btBoxShape(
    new Ammo.btVector3(scale.x / 2, scale.y / 2, scale.z / 2)
  );
  createRigidBody(mesh, shape, mass, pos, quat);
}

//  Integración Three.js + Ammo.js
function createRigidBody(mesh, shape, mass, pos, quat) {
  // Configurar posición inicial en Ammo
  const transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
  transform.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));

  // Calcular inercia (resistencia a rotar) si tiene masa
  const localInertia = new Ammo.btVector3(0, 0, 0);
  if (mass > 0) shape.calculateLocalInertia(mass, localInertia);

  // Crear el cuerpo rígido
  const motionState = new Ammo.btDefaultMotionState(transform);
  const body = new Ammo.btRigidBody(
    new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia)
  );

  // Fricción (roce) y Restitución (rebote)
  body.setFriction(0.5);
  body.setRestitution(0.6);

  // Vincular: Guardamos el cuerpo físico DENTRO del objeto visual (userData)
  mesh.userData.physicsBody = body;
  escena.add(mesh);

  if (mass > 0) cuerposRigidos.push(mesh); // Añadir a la lista de actualización
  mundoFisico.addRigidBody(body); // Añadir física a Ammo.js
}

/* --------------------------------------------------
   CONTROLES
-------------------------------------------------- */

function initInput() {
  window.addEventListener("keydown", (event) => {
    // Si ya lanzamos, solo permitimos 'R' para reiniciar
    if (isBallThrown) {
      if (event.key.toLowerCase() === "r") location.reload();
      return;
    }
    // Controles antes de lanzar
    switch (event.key) {
      case "a": // Mover a la izquierda
        throwAngle += 0.1;
        break;
      case "d": // Mover a la derecha
        throwAngle -= 0.1;
        break;
      case " ": // ESPACIO: Lanzar
        throwBall();
        break;
    }
    if (flechaDireccion) actualizarFlecha();
  });
}

function actualizarFlecha() {
  // Rota y posiciona la flecha basándose en el ángulo actual
  flechaDireccion.rotation.y = throwAngle;
  // Trigonometría simple para mover la flecha en arco
  flechaDireccion.position.x = Math.sin(throwAngle) * 2;
  flechaDireccion.position.z = 8 + Math.cos(throwAngle) * 2;
}

function throwBall() {
  isBallThrown = true;
  if (flechaDireccion) flechaDireccion.visible = false; // Ocultar flecha

  audioThrow.currentTime = 0;
  audioThrow.play().catch(() => {});

  // Calcular vector de fuerza según el ángulo
  const forceMagnitude = 500; // Fuerza del empuje
  const forceX = -Math.sin(throwAngle) * forceMagnitude;
  const forceZ = -Math.cos(throwAngle) * forceMagnitude;

  // Activar física (Estado 1 = Activo) y empujar
  cuerpoBola.setActivationState(1);
  cuerpoBola.applyCentralImpulse(new Ammo.btVector3(forceX, 0, forceZ));

  // Animación de cámara cinemática con TWEEN
  new TWEEN.Tween(camera.position)
    .to({ x: 0, y: 3, z: -15 }, 2000) // Mover cámara cerca de los bolos en 2 segundos
    .easing(TWEEN.Easing.Cubic.Out)
    .start();
  new TWEEN.Tween(camera.rotation).to({ x: -0.1 }, 2000).start(); // Inclinar cámara

  // Calcular puntuación después de 5 segundos
  setTimeout(calculateScore, 5000);
}

function createArrow() {
  // Dibuja una forma 2D manualmente punto por punto
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.5);
  shape.lineTo(0.6, 0.2);
  shape.lineTo(0.2, 0.2);
  shape.lineTo(0.2, -1.0);
  shape.lineTo(-0.2, -1.0);
  shape.lineTo(-0.2, 0.2);
  shape.lineTo(-0.6, 0.2);
  shape.lineTo(0, 1.5);

  const geometry = new THREE.ShapeGeometry(shape);
  // Rotar la geometría para que quede plana en el suelo (XZ)
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.DoubleSide,
  });

  flechaDireccion = new THREE.Mesh(geometry, material);
  flechaDireccion.position.y = 0.5; // Un poco elevado para no traspasar el suelo
  escena.add(flechaDireccion);
}

/* --------------------------------------------------
   PUNTUACIÓN 
-------------------------------------------------- */

function calculateScore() {
  score = 0;
  const worldUp = new THREE.Vector3(0, 1, 0); // Vector "Arriba" global

  bolos.forEach((pin) => {
    // Obtener datos físicos del bolo
    const cuerpo = pin.userData.physicsBody;
    const transform = new Ammo.btTransform();
    cuerpo.getMotionState().getWorldTransform(transform);
    const pos = transform.getOrigin();

    // Calcular si está caído:
    // Obtenemos el vector "Arriba" local del bolo
    const localUp = new THREE.Vector3(0, 1, 0);
    localUp.applyQuaternion(pin.quaternion);
    // Comparamos el ángulo entre el Arriba del bolo y el Arriba del mundo
    const angle = localUp.angleTo(worldUp);

    // Si está muy bajo (cayó del mapa) O inclinado más de 45 grados (PI/4)
    const derribado = pos.y() < 0.2 || angle > Math.PI / 4;

    const mat = pin.userData.mainMaterial || pin.material;

    if (derribado) {
      score++;
      // Pintar de rojo el bolo caído
      if (mat) mat.color.setHex(0xff0000);
    } else {
      // Restaurar color original si sigue en pie
      if (mat && mat.userData.originalColor) {
        mat.color.copy(mat.userData.originalColor);
      }
    }
  });

  // Actualizar UI HTML
  if (uiScore) uiScore.innerText = score;

  // Lógica de feedback (Mensajes y sonidos)
  if (score === 10) {
    if (uiMsg) {
      uiMsg.innerText = "★ ¡¡STRIKE CÓSMICO!! ★";
      uiMsg.style.color = "#00ff00";
    }
    playSound(audioStrike, "¡Strike!");
    playStrikeAnimation(); // Animación extra de cámara
  } else if (score >= 3) {
    if (uiMsg) {
      uiMsg.innerText = "¡Buen lanzamiento!";
      uiMsg.style.color = "#ffff00";
    }
    playSound(audioGood, "Bien hecho");
  } else {
    if (uiMsg) {
      uiMsg.innerText = "Inténtalo de nuevo...";
      uiMsg.style.color = "#ff4444";
    }
    playSound(audioBad, "Ups, qué malo");
  }
}

function playSound(audioObj, fallbackText) {
  // Intenta reproducir MP3, si falla usa la voz del navegador (SpeechSynthesis)
  audioObj.play().catch(() => {
    const utterance = new SpeechSynthesisUtterance(fallbackText);
    utterance.rate = 1.2;
    window.speechSynthesis.speak(utterance);
  });
}

function playStrikeAnimation() {
  // Efecto de cámara "saltando" de alegría
  new TWEEN.Tween(camera.position)
    .to({ y: camera.position.y + 1 }, 200)
    .yoyo(true) // Va y vuelve
    .repeat(5) // 5 veces
    .start();
}

/* --------------------------------------------------
   BUCLE PRINCIPAL (ANIMACIÓN)
-------------------------------------------------- */

function onWindowResize() {
  // Ajustar cámara y renderer si el usuario cambia el tamaño de la ventana
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate); // Pedir el siguiente frame al navegador

  const deltaTime = 1 / 60; // Simulamos 60 FPS fijos para física
  TWEEN.update(); // Actualizar animaciones de cámara

  // Avanzar la simulación física un paso
  mundoFisico.stepSimulation(deltaTime, 10);

  // Recorremos todos los objetos rígidos y copiamos la posición calculada por Ammo
  // a la malla visual de Three.js.
  for (let i = 0; i < cuerposRigidos.length; i++) {
    const objThree = cuerposRigidos[i];
    const objPhys = objThree.userData.physicsBody;
    const ms = objPhys.getMotionState();
    if (ms) {
      ms.getWorldTransform(transformAux); // Obtener pos/rot física
      const p = transformAux.getOrigin();
      const q = transformAux.getRotation();
      // Aplicar a Three.js
      objThree.position.set(p.x(), p.y(), p.z());
      objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
  }
  // Dibujar la escena
  renderer.render(escena, camera);
}
