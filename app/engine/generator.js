/**
 * FERIXDI Studio — Generator v2
 * Production Contract: Veo 3.1 • 8s • Handheld Selfie Feel
 * Universal character adapter — работает с любой парой из каталога
 */

import { estimateDialogue } from './estimator.js';
import { runAllValidations, scanBannedWords } from './validators.js';
import { autoTrim } from './auto_trim.js';
import { historyCache } from './history_cache.js';

// ─── V2 TIMING GRID ─────────────────────────
const GRID_V2 = {
  hook:    { start: 0.0, end: 0.8 },
  act_A:   { start: 0.8, end: 3.6 },
  act_B:   { start: 3.6, end: 7.1 },
  release: { start: 7.1, end: 8.0 },
};

// ─── LOCATIONS ───────────────────────────────
const LOCATIONS = [
  'Weathered wooden barn interior, hay bales, single dusty lightbulb swinging, cracks of sunlight through planks',
  'Old bathhouse interior, fogged mirrors, wooden benches, copper ladle, steam wisps in backlight',
  'Root cellar with earthen walls, shelves of preserves in glass jars, bare bulb overhead, cool blue-tint air',
  'Chicken coop doorway, feathers floating in golden backlight, wooden perch, scratching hens out of focus',
  'Overgrown garden path, sunflowers towering overhead, rusty watering can, dappled light through foliage',
  'Dusty attic with exposed rafters, cardboard boxes, moth-eaten curtains, slanted skylight beam',
  'Soviet-era kitchen, peeling wallpaper, humming Saratov fridge, net curtains filtering amber sunlight',
  'Concrete balcony with drying laundry, distant city haze, rusted railing with chipped turquoise paint',
  'Dacha greenhouse with fogged glass panels, tomato vines, soil-stained wooden shelves',
  'Stairwell landing with beige tile, fluorescent tube buzzing overhead, mailboxes, elevator door ajar',
  'Open-air bazaar stall, pyramid of watermelons, striped awning, plastic bags rustling in breeze',
  'Polyclinic corridor, mint-green walls, wooden bench, numbered doors, faded health poster',
  'Marshrutka interior, vinyl seats, steamed windows, hanging air freshener, driver mirror reflection',
  'Garage interior, oil-stained concrete, tool pegboard, half-disassembled Moskvitch, bare bulb',
  'Park bench near pond with pigeons, birch trees, distant accordion music, golden hour light',
];

// ─── HOOK ACTIONS v2 ─────────────────────────
const HOOK_ACTIONS = [
  { action_en: 'sharp finger jab at lens, near-miss touch', action_ru: 'Палец в камеру, почти касаясь линзы', audio: 'mechanical trigger + sharp inhale' },
  { action_en: 'object tap on glass — knuckle rap on invisible screen', action_ru: 'Стук костяшками по "стеклу"', audio: 'knocking + surprised gasp' },
  { action_en: 'abrupt lean-in to camera, face filling frame', action_ru: 'Резкий наклон к камере, лицо заполняет кадр', audio: 'cloth rustle + tense exhale' },
  { action_en: 'slap on table surface, objects rattle', action_ru: 'Удар по столу, предметы подпрыгивают', audio: 'table slap + glass rattle' },
  { action_en: 'dramatic removal of glasses/hat as reveal', action_ru: 'Драматичное снятие очков/шапки', audio: 'fabric whoosh + stare-down silence' },
];

// ─── RELEASE ACTIONS v2 ──────────────────────
const RELEASE_ACTIONS = [
  { action_en: 'shared raspy wheeze-laugh, camera shakes from body tremor', action_ru: 'Общий хриплый смех, камера трясётся от тряски тела' },
  { action_en: 'A slaps own knee, B doubles over, tears forming', action_ru: 'A хлопает по колену, B сгибается пополам, слёзы' },
  { action_en: 'both lean into each other laughing, brief embrace', action_ru: 'Оба заваливаются друг на друга от смеха' },
  { action_en: 'A covers mouth suppressing laugh, B slow triumphant grin', action_ru: 'A зажимает рот, B медленная победная ухмылка' },
  { action_en: 'synchronized head-throw-back cackle, camera jolts', action_ru: 'Синхронный хохот с запрокинутой головой' },
];

// ─── SERIAL PROP ANCHORS ─────────────────────
const PROP_ANCHORS = ['old brass samovar', 'dented aluminum bucket', 'cast-iron poker', 'cracked enamel kettle', 'wobbly wooden stool', 'vintage radio', 'wall-mounted rotary phone'];

const HUMOR_CATEGORIES = [
  { ru: 'Бытовой абсурд', en: 'Domestic absurdity' },
  { ru: 'AI и технологии', en: 'AI and technology' },
  { ru: 'Цены и инфляция', en: 'Prices and inflation' },
  { ru: 'Отношения', en: 'Relationships' },
  { ru: 'Разрыв поколений', en: 'Generation gap' },
  { ru: 'ЖКХ и коммуналка', en: 'Housing utilities drama' },
  { ru: 'Здоровье и поликлиника', en: 'Health and polyclinic' },
  { ru: 'Соцсети и тренды', en: 'Social media trends' },
  { ru: 'Дача и огород', en: 'Dacha and gardening' },
  { ru: 'Транспорт и пробки', en: 'Transport and traffic' },
];

const DEMO_DIALOGUES = {
  'Бытовой абсурд': {
    A_lines: ['Ты видел что они с хлебом сделали?! | Квадратный! КВАДРАТНЫЙ!'],
    B_lines: ['И чё? | Земля тоже не круглая | а ты на ней живёшь.'],
    killer_word: 'живёшь'
  },
  'AI и технологии': {
    A_lines: ['Этот твой искусственный интеллект | мне БОРЩ сварит?!'],
    B_lines: ['Он тебе уже внуков воспитывает | а ты не заметила.'],
    killer_word: 'заметила'
  },
  'Цены и инфляция': {
    A_lines: ['За МОЛОКО! | Восемьсот рублей! За *молоко*!'],
    B_lines: ['В девяносто третьем | за эти деньги | я машину купил.'],
    killer_word: 'машину'
  },
  'Отношения': {
    A_lines: ['Он мне пишет | «привет как дела» | Это что — УХАЖИВАНИЕ?!'],
    B_lines: ['В наше время | мужик молча забор чинил | и это была любовь.'],
    killer_word: 'любовь'
  },
  'Разрыв поколений': {
    A_lines: ['Внучка говорит — я теперь | «контент-мейкер» | Чё это?!'],
    B_lines: ['Это значит | она тоже нихрена не делает | но с телефоном.'],
    killer_word: 'телефоном'
  },
  'ЖКХ и коммуналка': {
    A_lines: ['За отопление | шесть тыщ! | А батарея ХОЛОДНАЯ!'],
    B_lines: ['Зато душу | они тебе давно | натопили.'],
    killer_word: 'натопили'
  },
  'Здоровье и поликлиника': {
    A_lines: ['Врач говорит | «гуглите» | Серьёзно?! ГУГЛИТЕ?!'],
    B_lines: ['Хорошо что не сказал | «спросите у нейросети» | та вообще похоронит.'],
    killer_word: 'похоронит'
  },
  'Соцсети и тренды': {
    A_lines: ['У неё миллион подписчиков! | МИЛЛИОН! | А посуду не моет!'],
    B_lines: ['Миллион людей | смотрят как она не моет | и лайкают.'],
    killer_word: 'лайкают'
  },
  'Дача и огород': {
    A_lines: ['Помидоры! | Сожрали! | Все до единого! КТО?!'],
    B_lines: ['Сосед Михалыч | он же теперь веган | ему положено.'],
    killer_word: 'положено'
  },
  'Транспорт и пробки': {
    A_lines: ['Два часа! | ДВА ЧАСА стояла! | Самокат обогнал!'],
    B_lines: ['Самокат | это транспорт будущего | а ты — прошлого.'],
    killer_word: 'прошлого'
  },
};

// ─── UTILS ───────────────────────────────────
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = ((h << 5) - h + seed.charCodeAt(i)) | 0; }
  return () => { h = (h * 16807 + 0) % 2147483647; return (h & 0x7fffffff) / 2147483647; };
}

function pickRandom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// ─── UNIVERSAL ROLE ADAPTER ──────────────────
// Maps any character pair to A/B roles based on their data.
// A = more expressive/provocative; B = more grounded/rational.
// User manual assignment (role_default) takes priority.
function resolveRoles(charA, charB) {
  // If user explicitly assigned roles, respect that
  if (charA.role_default === 'A' && charB.role_default === 'B') return { A: charA, B: charB };
  if (charA.role_default === 'B' && charB.role_default === 'A') return { A: charB, B: charA };

  // Auto-assign: compute expressiveness score
  // Higher score → role A (provocateur)
  const score = (c) => {
    let s = 0;
    if (c.speech_pace === 'fast') s += 3;
    else if (c.speech_pace === 'normal') s += 1;
    s += c.swear_level || 0;
    if (c.compatibility === 'chaotic') s += 2;
    else if (c.compatibility === 'conflict') s += 1;
    else if (c.compatibility === 'calm') s -= 2;
    if (c.role_default === 'A') s += 1;
    if (c.role_default === 'B') s -= 1;
    return s;
  };

  const scoreA = score(charA);
  const scoreB = score(charB);
  // Higher score gets role A
  if (scoreB > scoreA) return { A: charB, B: charA };
  return { A: charA, B: charB };
}

// ─── CAST CONTRACT BUILDER (universal) ───────
function buildCastContract(charA, charB) {
  const buildBiology = (char, role) => {
    const bio = char.biology_override || {};
    const anchors = char.identity_anchors || {};
    const defaultSkin = ['deep wrinkles', 'age spots', 'visible pores', 'subtle skin sheen (not plastic)'];
    const defaultEyes = ['wet glint', 'slight sclera redness', 'micro-saccades'];
    return {
      character_en: char.prompt_tokens.character_en,
      age: bio.age || 'elderly',
      skin: (bio.skin_tokens || defaultSkin).join(', '),
      eyes: (bio.eye_tokens || defaultEyes).join(', '),
      mouth: role === 'A'
        ? 'realistic teeth/gums, lip moisture, lip-bite as comedic pafos-anchor (sparingly), micro saliva glints'
        : 'realistic teeth/gums, lip moisture, mouth SEALED when not speaking, jaw still',
      face_silhouette: anchors.face_silhouette || 'distinctive facial features',
      signature_element: anchors.signature_element || 'notable accessory',
      micro_gesture: anchors.micro_gesture || 'subtle expression change',
      wardrobe_anchor: anchors.wardrobe_anchor || 'distinctive clothing piece',
      vibe: char.vibe_archetype || (role === 'A' ? 'провокатор' : 'база'),
    };
  };
  return {
    speaker_A: buildBiology(charA, 'A'),
    speaker_B: buildBiology(charB, 'B'),
    relationship: 'BAND — insults target SITUATION only, never each other',
  };
}

// ─── CAMERA & REALISM PRESET (v2) ────────────
function buildCameraPreset() {
  return {
    pov: 'held at arm\'s length, front-facing portrait look, device INVISIBLE',
    distance: 'close enough to read skin microtexture, both faces in frame',
    artifacts: [
      'handheld micro-jitter',
      'subtle exposure breathing',
      'mild rolling shutter only on quick micro-moves',
      'brief autofocus hunt ≤0.15s on lens approach',
    ],
    realism_anchors: [
      'slight sensor noise',
      'mild compression artifacts',
      'imperfect white balance drift',
      'micro motion blur on sharp gesture (finger/slap)',
      'realistic shadowing under nose/cheekbones',
    ],
  };
}

// ─── TIMING GRID BUILDER (v2) ────────────────
function buildTimingGridV2(hookObj, releaseObj) {
  return {
    total_seconds: 8.0,
    tolerance_s: 0.2,
    grid: [
      { segment: 'hook', ...GRID_V2.hook, action_en: hookObj.action_en, audio: hookObj.audio },
      { segment: 'act_A', ...GRID_V2.act_A, action_en: 'Speaker A delivers short pompous provocation (6-9 words), animated gestures, direct camera gaze', other: 'B silent: sealed lips, jaw still, eyes/micro-reactions only' },
      { segment: 'act_B', ...GRID_V2.act_B, action_en: 'Speaker B responds with punchline (6-11 words), measured delivery building to killer word near end', other: 'A frozen in pose, mouth closed' },
      { segment: 'release', ...GRID_V2.release, action_en: releaseObj.action_en, note: 'ZERO words, shared laughter only' },
    ],
  };
}

// ─── QC GATE (v2) ────────────────────────────
// Pre-flight check on generated package. Returns pass/fail + details.
function runQCGate(blueprint, cast) {
  const checks = [
    { id: 1, name: 'face_stability', pass: !!cast.speaker_A.face_silhouette && !!cast.speaker_B.face_silhouette, hard: true },
    { id: 2, name: 'skin_microtexture', pass: cast.speaker_A.skin.includes('pores') || cast.speaker_A.skin.includes('wrinkles'), hard: false },
    { id: 3, name: 'eyes_alive', pass: cast.speaker_A.eyes.includes('saccades') || cast.speaker_A.eyes.includes('glint'), hard: false },
    { id: 4, name: 'mouth_realistic', pass: cast.speaker_A.mouth.includes('teeth') || cast.speaker_A.mouth.includes('lip'), hard: true },
    { id: 5, name: 'silent_sealed', pass: cast.speaker_B.mouth.includes('SEALED') || cast.speaker_B.mouth.includes('sealed'), hard: true },
    { id: 6, name: 'background_solid', pass: blueprint.scenes.every(s => !s.action?.includes('pattern') && !s.action?.includes('abstract')), hard: false },
    { id: 7, name: 'camera_artifacts', pass: !!blueprint.scenes.find(s => s.segment === 'hook')?.speech_hints, hard: false },
    { id: 8, name: 'audio_no_overlap', pass: blueprint.scenes.every((s, i, arr) => i === 0 || s.start >= arr[i - 1].end - 0.05), hard: false },
    { id: 9, name: 'hook_readable', pass: blueprint.scenes[0].end <= 0.85, hard: false },
    { id: 10, name: 'laugh_natural', pass: blueprint.scenes[blueprint.scenes.length - 1].dialogue_ru === '', hard: false },
  ];
  const passed = checks.filter(c => c.pass).length;
  const hardFails = checks.filter(c => c.hard && !c.pass);
  return {
    passed,
    total: checks.length,
    ok: passed >= 9 && hardFails.length === 0,
    hard_fails: hardFails.map(c => c.name),
    details: checks,
  };
}

export function getRandomCategory(seed) {
  const rng = seededRandom(seed || Date.now().toString());
  return pickRandom(HUMOR_CATEGORIES, rng);
}

export function generate(input) {
  const {
    input_mode = 'idea',
    character1_id, character2_id,
    context_ru, script_ru, scene_hint_ru,
    category, thread_memory, video_meta,
    options = {}, seed = Date.now().toString(),
    characters = []
  } = input;

  const rng = seededRandom(seed);
  const rawA = characters.find(c => c.id === character1_id) || characters[0];
  const rawB = characters.find(c => c.id === character2_id) || characters[1] || characters[0];

  if (!rawA || !rawB) {
    return { error: 'Characters not found', warnings: ['Выберите двух персонажей'] };
  }

  const { A: charA, B: charB } = resolveRoles(rawA, rawB);
  const cat = category || pickRandom(HUMOR_CATEGORIES, rng);

  // ── Location (avoid repeats) ──
  const locIdx = Math.floor(rng() * LOCATIONS.length);
  let location = LOCATIONS[locIdx];
  if (historyCache.hasLocation(location)) {
    location = LOCATIONS[(locIdx + 1) % LOCATIONS.length];
  }

  // ── Wardrobe from character anchors (full description, not just a keyword) ──
  const wardrobeA = charA.identity_anchors?.wardrobe_anchor || 'silk floral blouse with mother-of-pearl buttons, velvet collar';
  const wardrobeB = charB.identity_anchors?.wardrobe_anchor || 'worn striped sailor telnyashka under patched corduroy jacket, leather belt';

  // ── Hook & Release ──
  const hookObj = pickRandom(HOOK_ACTIONS, rng);
  const releaseObj = pickRandom(RELEASE_ACTIONS, rng);

  // ── Serial prop anchor ──
  const propAnchor = pickRandom(PROP_ANCHORS, rng);

  // ── Dialogue based on mode ──
  let dialogueA, dialogueB, killerWord;
  const demoKey = (cat.ru in DEMO_DIALOGUES) ? cat.ru : Object.keys(DEMO_DIALOGUES)[Math.floor(rng() * Object.keys(DEMO_DIALOGUES).length)];
  const demo = DEMO_DIALOGUES[demoKey];

  if (input_mode === 'script' && script_ru) {
    dialogueA = script_ru.A || demo.A_lines[0];
    dialogueB = script_ru.B || demo.B_lines[0];
    killerWord = dialogueB.split(/\s+/).pop()?.replace(/[^а-яёa-z]/gi, '') || 'панч';
  } else if (input_mode === 'video' && video_meta) {
    dialogueA = demo.A_lines[0];
    dialogueB = demo.B_lines[0];
    killerWord = demo.killer_word;
  } else {
    dialogueA = demo.A_lines[0];
    dialogueB = demo.B_lines[0];
    killerWord = demo.killer_word;
  }

  // ── Estimate duration ──
  const lines = [
    { speaker: 'A', text: dialogueA, pace: charA.speech_pace },
    { speaker: 'B', text: dialogueB, pace: charB.speech_pace },
  ];

  let estimate = estimateDialogue(lines, { enforce8s: options.enforce8s !== false });
  let autoFixes = [];

  if (options.allowAutoTrim && estimate.risk === 'high') {
    const trimResult = autoTrim(lines, {});
    if (trimResult.trimmed) {
      dialogueA = trimResult.lines[0]?.text || dialogueA;
      dialogueB = trimResult.lines[1]?.text || dialogueB;
      autoFixes = trimResult.auto_fixes;
      estimate = trimResult.estimate;
    }
  }

  // ── Safety: scan banned words (apply replacements) ──
  const safeA = scanBannedWords(dialogueA);
  const safeB = scanBannedWords(dialogueB);
  dialogueA = safeA.text;
  dialogueB = safeB.text;
  if (safeA.fixes.length) autoFixes.push(...safeA.fixes);
  if (safeB.fixes.length) autoFixes.push(...safeB.fixes);

  // ── Build all blocks ──
  const cast = buildCastContract(charA, charB);
  const cameraPreset = buildCameraPreset();
  const timingGrid = buildTimingGridV2(hookObj, releaseObj);
  const aesthetic = charA.world_aesthetic || charB.world_aesthetic || 'VIP-деревенский уют';

  // ── PHOTO PROMPT (EN) ──
  const anchorA = charA.identity_anchors || {};
  const anchorB = charB.identity_anchors || {};

  const photo_prompt_en_json = {
    scene: `Hyper-realistic close-up still frame. Two characters in heated comedic argument. ${location}. Natural backlight, hard shadows, dust motes in beams. ${aesthetic} aesthetic. Vertical 9:16. Shot on handheld phone, device invisible.`,
    characters: [
      {
        role: 'A',
        appearance: charA.prompt_tokens.character_en,
        face_anchor: anchorA.face_silhouette || 'distinctive face',
        signature: anchorA.signature_element || 'notable accessory',
        expression: `mid-sentence animated, ${anchorA.micro_gesture || 'expressive gesture'}, direct intense eye contact`,
        wardrobe: wardrobeA,
      },
      {
        role: 'B',
        appearance: charB.prompt_tokens.character_en,
        face_anchor: anchorB.face_silhouette || 'distinctive face',
        signature: anchorB.signature_element || 'notable accessory',
        expression: `stoic unimpressed, ${anchorB.micro_gesture || 'raised eyebrow'}, mouth firmly closed, arms crossed`,
        wardrobe: wardrobeB,
      },
    ],
    environment: {
      location,
      lighting: 'natural backlight with hard shadows, dust motes ONLY if backlight present, warm 3200K',
      prop_anchor: propAnchor,
      props: ['worn surface', propAnchor, 'ambient domestic detail'],
    },
    camera: {
      angle: 'slightly below eye level, selfie POV at arm\'s length',
      distance: 'close enough to read skin, both faces in frame',
      lens: '24mm equivalent, f/2.0, shallow DOF',
      realism: cameraPreset.realism_anchors.join(', '),
    },
    style: 'photorealistic, cinematic grain, raw authentic feel, no filters',
    negative: 'no text, no watermark, no logo, no phone visible, no camera visible, no overlay, no cartoon, no anime, no plastic skin',
  };

  // ── VIDEO PROMPT (EN) ──
  const video_prompt_en_json = {
    cast,
    identity_anchors: {
      A: { silhouette: anchorA.face_silhouette, element: anchorA.signature_element, gesture: anchorA.micro_gesture },
      B: { silhouette: anchorB.face_silhouette, element: anchorB.signature_element, gesture: anchorB.micro_gesture },
      serial: { aesthetic, prop_anchor: propAnchor },
    },
    vibe: {
      dynamic: `${charA.name_ru} (A, ${charA.vibe_archetype || 'провокатор'}) → ${charB.name_ru} (B, ${charB.vibe_archetype || 'база'})`,
      hook: hookObj.action_en,
      conflict: `Comedic tension about ${cat.en.toLowerCase()}, no personal insults, rage directed at situation only`,
      punchline: `Killer word "${killerWord}" lands near 7.0s mark, followed by ${releaseObj.action_en}`,
    },
    camera: cameraPreset,
    world: {
      location,
      lighting: 'natural backlight, hard shadows, dust motes in beams when applicable',
      wardrobe_A: wardrobeA,
      wardrobe_B: wardrobeB,
      prop_anchor: propAnchor,
    },
    timing: timingGrid,
    audio: {
      room_tone: true,
      cloth_rustle: 'on movement',
      saliva_clicks: 'on consonants',
      overlap_policy: 'STRICTLY FORBIDDEN. Gap 0.15-0.25s stitch between speakers.',
      mouth_rule: 'Non-speaking character: sealed lips, jaw still, subtle eye tracking only',
      laugh: 'louder than dialogue, no clipping, raspy and contagious',
    },
    safety: {
      banned_words_replaced: true,
      device_invisible: true,
      no_overlays: true,
      no_text_in_frame: true,
      content_type: 'satirical/domestic',
    },
    output: { format: 'mp4 h264', resolution: '1080x1920 vertical 9:16', fps: 30, duration: '8.0s ±0.2s' },
  };

  // ── RU PACKAGE ──
  const hashMem = thread_memory ? (typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(thread_memory))).slice(0, 8) : 'mem') : 'none';
  const ru_package = `🎬 ДИАЛОГ С ТАЙМИНГАМИ (v2 Production Contract)
═══════════════════════════════════════════
[0.00–0.80] 🎣 ХУК: ${hookObj.action_ru}
  🔊 Звук: ${hookObj.audio}

[0.80–3.60] 🅰️ ${charA.name_ru} (${charA.vibe_archetype || 'роль A'}):
  «${dialogueA}»
  💬 Темп: ${charA.speech_pace} | Слов: 6-9 | ${charA.swear_level > 0 ? 'мат как акцент' : 'без мата'}
  🎭 Микрожест: ${anchorA.micro_gesture || charA.modifiers.hook_style}
  ⛔ B молчит: губы сомкнуты, челюсть неподвижна

[3.60–7.10] 🅱️ ${charB.name_ru} (${charB.vibe_archetype || 'роль B'}):
  «${dialogueB}»
  💬 Темп: ${charB.speech_pace} | Слов: 6-11 | паузы = сила
  💥 KILLER WORD «${killerWord}» → ближе к 7.0s
  ⛔ A замерла в позе, рот закрыт

[7.10–8.00] 😂 RELEASE: ${releaseObj.action_ru}
  🔊 Смех громче реплик, без клиппинга

═══════════════════════════════════════════
📱 ВИРАЛЬНЫЙ ЗАГОЛОВОК:
${charA.name_ru} vs ${charB.name_ru}: ${cat.ru} 💥

📌 ЗАКРЕП:
Пересылай это видео тому, кто думает что ${cat.ru.toLowerCase()} — это нормально 😂🔥

#️⃣ ХЭШТЕГИ (РФ 2026):
#юмор #ржака #смешно #видео #тренды #рекомендации #reels #shorts #viral #мем #comedy #funny #${charA.name_ru.replace(/\s+/g, '').toLowerCase()} #${charB.name_ru.replace(/\s+/g, '').toLowerCase()} #${cat.ru.replace(/\s+/g, '').toLowerCase()} #ferixdi`;

  // ── BLUEPRINT JSON ──
  const blueprint_json = {
    version: '2.0',
    scenes: [
      { id: 1, segment: 'hook', action: hookObj.action_en, speaker: 'A', start: GRID_V2.hook.start, end: GRID_V2.hook.end, dialogue_ru: '', speech_hints: `${hookObj.audio}, ${charA.modifiers.hook_style}` },
      { id: 2, segment: 'act_A', action: 'Pompous provocation delivery', speaker: 'A', start: GRID_V2.act_A.start, end: GRID_V2.act_A.end, dialogue_ru: dialogueA, speech_hints: `${charA.speech_pace} pace, 6-9 words, ${charA.swear_level > 1 ? 'expressive accent' : 'controlled'}, B sealed` },
      { id: 3, segment: 'act_B', action: 'Punchline response', speaker: 'B', start: GRID_V2.act_B.start, end: GRID_V2.act_B.end, dialogue_ru: dialogueB, speech_hints: `${charB.speech_pace} pace, 6-11 words, killer word "${killerWord}" near end, A frozen` },
      { id: 4, segment: 'release', action: releaseObj.action_en, speaker: 'both', start: GRID_V2.release.start, end: GRID_V2.release.end, dialogue_ru: '', speech_hints: `zero words, ${charB.modifiers.laugh_style}, shared laugh` },
    ],
    dialogue_segments: [
      { speaker: 'A', text_ru: dialogueA, start: GRID_V2.act_A.start, end: GRID_V2.act_A.end, word_range: '6-9' },
      { speaker: 'B', text_ru: dialogueB, start: GRID_V2.act_B.start, end: GRID_V2.act_B.end, word_range: '6-11' },
    ],
    timing_grid: {
      total: 8.0,
      hook: [GRID_V2.hook.start, GRID_V2.hook.end],
      A: [GRID_V2.act_A.start, GRID_V2.act_A.end],
      B: [GRID_V2.act_B.start, GRID_V2.act_B.end],
      release: [GRID_V2.release.start, GRID_V2.release.end],
      killer_word_at: 6.85,
      gap_between_speakers: '0.15-0.25s',
    },
    identity_anchors: {
      A: charA.identity_anchors || {},
      B: charB.identity_anchors || {},
    },
  };

  // ── QC Gate ──
  const qc = runQCGate(blueprint_json, cast);

  // ── Validate ──
  const output = { photo_prompt_en_json, video_prompt_en_json, ru_package, blueprint_json };
  const validation = runAllValidations(output, historyCache);

  // ── Update history ──
  historyCache.addGeneration({
    location,
    props: [propAnchor],
    wardrobeA,
    wardrobeB,
    category: cat.ru,
  });

  const log = {
    seed,
    generator_version: '2.0',
    memory_hash: hashMem,
    characters: [charA.id, charB.id],
    vibes: [charA.vibe_archetype, charB.vibe_archetype],
    category: cat,
    qc_gate: { passed: qc.passed, total: qc.total, ok: qc.ok, hard_fails: qc.hard_fails },
    warnings: validation.warnings,
    auto_fixes: autoFixes,
    duration_estimate: estimate.total,
    input_mode,
    timestamp: new Date().toISOString(),
  };

  return {
    photo_prompt_en_json,
    video_prompt_en_json,
    ru_package,
    blueprint_json,
    log,
    warnings: [...validation.warnings, ...(qc.ok ? [] : [`QC Gate: ${qc.passed}/${qc.total} (need ≥9)${qc.hard_fails.length ? ', HARD FAIL: ' + qc.hard_fails.join(', ') : ''}`])],
    auto_fixes: [...autoFixes, ...validation.auto_fixes],
    duration_estimate: estimate,
    qc_gate: qc,
  };
}
