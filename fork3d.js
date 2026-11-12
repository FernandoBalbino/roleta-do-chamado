/*
 * Garfo 3D (Three.js) usado como ponteiro da roleta.
 * A malha é gerada por código (cabo, pescoço, cabeça e 4 dentes) e deformada
 * a cada quadro para o garfo "entortar" e balançar mole quando os pinos batem.
 *
 * Unidades: as mesmas da roleta (roleta = 600 unidades de diâmetro).
 * O garfo fica deitado no eixo X: ponta dos dentes em x = 0, cabo em x = 250.
 */
(function () {
  'use strict';

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
  const TAU = Math.PI * 2;

  const TILT = -0.9;   // inclinação (rad) para ver o garfo em perspectiva 3/4
  const FL = 250;      // comprimento total
  const XF = 214;      // a partir daqui o cabo é rígido (preso pelo pino)
  const PIN_X = 230;   // posição do pino
  const PADL = 10, PADR = 8, HALF_H = 86; // margem da área de desenho
  const TWIST = 0.006; // torção por unidade de flexão (dá brilho "gelatinoso")

  const clamp01 = (t) => Math.min(1, Math.max(0, t));
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  // Curvatura lateral do garfo (perfil): dentes sobem, pescoço afunda, cabo sobe.
  function zc(x) {
    const tip = x < 96 ? 7.5 * Math.pow(1 - x / 96, 2) : 0;
    const neck = -2.6 * Math.exp(-Math.pow((x - 122) / 20, 2));
    const handle = x > 150 ? 7 * Math.pow((x - 150) / 100, 2) : 0;
    return tip + neck + handle;
  }
  // Concavidade da cabeça (a "colher" do garfo).
  const cupAmt = (x) => 3.4 * (1 - sstep(84, 128, x));
  const HEAD = 29.8; // meia largura da cabeça
  const cupZ = (x, y) => cupAmt(x) * (y / HEAD) * (y / HEAD);

  function bodyProf(x) {
    let hw, ht;
    if (x < 74) { const f = Math.sqrt(Math.max(0, (x - 64) / 10)); hw = HEAD * f; ht = 1.8 * (0.35 + 0.65 * f); }
    else if (x < 118) { hw = HEAD - (HEAD - 6.2) * sstep(76, 118, x); ht = 1.8 + 1.1 * sstep(84, 118, x); }
    else if (x < 142) { hw = 6.2 + 0.6 * sstep(118, 142, x); ht = 2.9 - 0.3 * sstep(124, 142, x); }
    else if (x < 214) { hw = 6.8 + (14 - 6.8) * sstep(142, 214, x); ht = 2.6 - 0.2 * sstep(142, 214, x); }
    else { const f = Math.sqrt(Math.max(0, 1 - Math.pow((x - 214) / 36, 2))); hw = 14 * f; ht = 2.4 * (0.3 + 0.7 * f); }
    return { hw: Math.max(hw, 0.05), ht: Math.max(ht, 0.05), yc: 0, zc: zc(x), cup: true };
  }

  function tineProf(yk) {
    return function (x) {
      const tipF = x < 10 ? Math.pow(x / 10, 0.6) : 1;
      // os dentes alargam perto da raiz e se fundem na cabeça (vão em "U")
      const hw = (3.0 + 2.0 * (x / 78)) * tipF + 2.45 * sstep(52, 78, x);
      const ht = (1.2 + 0.4 * (x / 78)) * (x < 10 ? 0.3 + 0.7 * Math.sqrt(x / 10) : 1);
      const yc = yk * (1 + 0.035 * (1 - x / 78));
      return { hw: Math.max(hw, 0.04), ht: Math.max(ht, 0.04), yc, zc: zc(x), cup: true };
    };
  }

  // Gera um "tubo" com seção superelíptica ao longo de X, com tampas nas pontas.
  function buildForkArrays() {
    const P = [];
    const I = [];
    function addTube(x0, x1, N, M, prof, e) {
      const base = P.length / 3;
      for (let i = 0; i <= N; i++) {
        const t = 0.5 - 0.5 * Math.cos(Math.PI * (i / N)); // mais anéis nas pontas
        const x = x0 + (x1 - x0) * t;
        const p = prof(x);
        for (let j = 0; j < M; j++) {
          const th = (j / M) * TAU;
          const c = Math.cos(th), s = Math.sin(th);
          const ey = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
          const ez = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
          const y = p.yc + p.hw * ey;
          const z = p.zc + (p.cup ? cupZ(x, y) : 0) + p.ht * ez;
          P.push(x, y, z);
        }
      }
      const p0 = prof(x0), p1 = prof(x1);
      const sIdx = P.length / 3;
      P.push(x0, p0.yc, p0.zc + (p0.cup ? cupZ(x0, p0.yc) : 0));
      P.push(x1, p1.yc, p1.zc + (p1.cup ? cupZ(x1, p1.yc) : 0));
      const eIdx = sIdx + 1;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < M; j++) {
          const a = base + i * M + j;
          const b = base + i * M + ((j + 1) % M);
          const c = base + (i + 1) * M + j;
          const d = base + (i + 1) * M + ((j + 1) % M);
          I.push(a, b, c, b, d, c);
        }
      }
      for (let j = 0; j < M; j++) {
        I.push(sIdx, base + ((j + 1) % M), base + j);
        I.push(eIdx, base + N * M + j, base + N * M + ((j + 1) % M));
      }
    }
    addTube(64, FL, 150, 32, bodyProf, 3.6);
    for (const yk of [-22.5, -7.5, 7.5, 22.5]) addTube(0, 80, 64, 16, tineProf(yk), 2.6);
    return { P, I };
  }

  // Ambiente de estúdio para o reflexo cromado (sem depender de arquivos extras).
  function buildEnvScene(THREE) {
    const scene = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x2a2544, side: THREE.BackSide })
    );
    room.scale.set(20, 14, 20);
    scene.add(room);
    const panel = (w, h, intensity, color, x, y, z) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      scene.add(m);
    };
    // faixas claras e escuras alternadas = reflexo cromado com contraste
    panel(16, 4.5, 4.2, 0xffffff, 0, 6.9, -3.2);  // softbox grande de cima (reflexo das faces)
    panel(16, 1.1, 6.0, 0xffffff, 0, 6.9, 2.2);   // faixa fina de cima
    panel(16, 1.4, 3.0, 0xf2f6ff, 0, 6.9, 5.2);   // faixa de cima, frente
    panel(10, 2.2, 2.6, 0xffffff, 0, 2.5, 9.8);   // faixa frontal
    panel(2.4, 8, 2.6, 0xdfe8ff, -9.8, 1, 1);     // faixa fria à esquerda
    panel(2.4, 8, 2.2, 0xffe2c2, 9.8, 0, -1);     // faixa quente à direita
    panel(16, 3, 1.6, 0xcfd8ff, 0, 1.5, -9.8);    // parede do fundo
    panel(6, 1.2, 1.4, 0xffffff, 0, -3.2, 9.8);   // contraluz baixo
    return scene;
  }

  async function createFork3D(host) {
    const THREE = await import(THREE_URL);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const canvas = renderer.domElement;
    canvas.className = 'fork-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(buildEnvScene(THREE), 0.03).texture;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(-120, 260, 380);
    scene.add(key);

    const cam = new THREE.OrthographicCamera(-PADL, FL + PADR, HALF_H, -HALF_H, -500, 500);
    cam.position.set(0, 0, 200);
    cam.lookAt(0, 0, 0);

    // ----- malha do garfo -----
    const { P, I } = buildForkArrays();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setIndex(I);
    geo.rotateX(TILT);

    // centraliza a ponta (entre os dentes do meio) no y = 0 da tela
    const sinT = Math.sin(TILT), cosT = Math.cos(TILT);
    const zTip = zc(0) + cupZ(0, 7.5 * 1.035);
    const shiftY = zTip * sinT; // y' da ponta = -zTip*sinT  →  desloca de volta
    geo.translate(0, shiftY, 0);
    geo.computeVertexNormals();

    const pos = geo.attributes.position;
    const count = pos.count;
    const BASE = new Float32Array(pos.array);
    const PHI1 = new Float32Array(count);
    const PHI2 = new Float32Array(count);
    const AY = new Float32Array(count);
    const AZ = new Float32Array(count);
    let contactHalf = 0;
    for (let i = 0; i < count; i++) {
      const x = BASE[i * 3];
      const s = clamp01((XF - x) / XF); // 0 = preso no cabo, 1 = ponta
      PHI1[i] = (s * s * (3 - s)) / 2;  // modo 1: flexão de viga em balanço
      PHI2[i] = Math.sin(Math.PI * s) * s * 1.6; // modo 2: "barriga" que balança
      const z0 = zc(x);
      AY[i] = -z0 * sinT + shiftY;
      AZ[i] = z0 * cosT;
      if (x > 4 && x < 20) contactHalf = Math.max(contactHalf, BASE[i * 3 + 1]);
    }

    const chrome = new THREE.MeshStandardMaterial({
      color: 0xf3f5f9,
      metalness: 1,
      roughness: 0.13,
      envMapIntensity: 1.25,
    });
    const mesh = new THREE.Mesh(geo, chrome);
    scene.add(mesh);

    // pino vermelho que "segura" o cabo
    const pinGroup = new THREE.Group();
    const pinMat = new THREE.MeshPhysicalMaterial({ color: 0xe63946, roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 4, 32), pinMat);
    stem.rotation.x = Math.PI / 2;
    stem.position.z = 2;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(6.2, 32, 16, 0, TAU, 0, Math.PI / 2), pinMat);
    dome.rotation.x = Math.PI / 2;
    dome.scale.set(1, 0.55, 1);
    dome.position.z = 4;
    pinGroup.add(stem, dome);
    const pinZ = zc(PIN_X) + 2.3;
    pinGroup.position.set(PIN_X, 0, pinZ);
    const pinWrap = new THREE.Group();
    pinWrap.add(pinGroup);
    pinWrap.rotation.x = TILT;
    pinWrap.position.y = shiftY;
    scene.add(pinWrap);

    let lastB = NaN, lastW = NaN;

    function deform(b, w) {
      const arr = pos.array;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        const f1 = PHI1[i], f2 = PHI2[i];
        if (f1 === 0 && f2 === 0) { arr[k + 1] = BASE[k + 1]; arr[k + 2] = BASE[k + 2]; continue; }
        const disp = b * f1 + w * f2;
        const tau = TWIST * disp;
        const ry = BASE[k + 1] - AY[i];
        const rz = BASE[k + 2] - AZ[i];
        const ct = Math.cos(tau), st = Math.sin(tau);
        arr[k + 1] = AY[i] + ry * ct - rz * st - disp; // b > 0 = para baixo na tela
        arr[k + 2] = AZ[i] + ry * st + rz * ct + 0.3 * w * f2;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    }

    return {
      canvas,
      PADL,
      HALF_H,
      FL,
      contactHalf,
      mount() { host.appendChild(canvas); },
      setScale(k) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        renderer.setPixelRatio(dpr);
        renderer.setSize(Math.round((PADL + FL + PADR) * k), Math.round(HALF_H * 2 * k), true);
        lastB = NaN; // força redesenho
      },
      render(b, w) {
        if (Math.abs(b - lastB) < 0.004 && Math.abs(w - lastW) < 0.004) return;
        lastB = b; lastW = w;
        deform(b, w);
        renderer.render(scene, cam);
      },
    };
  }

  window.createFork3D = createFork3D;
})();
