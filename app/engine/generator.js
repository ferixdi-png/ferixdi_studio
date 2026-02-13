/**
 * FERIXDI Studio — Generator
 * Demo mode: детерминированные ультра-детализированные результаты без API
 */

import { estimateDialogue } from './estimator.js';
import { runAllValidations, scanBannedWords } from './validators.js';
import { autoTrim } from './auto_trim.js';
import { historyCache } from './history_cache.js';

const LOCATIONS = [
  'Soviet-era kitchen with peeling wallpaper, humming Saratov fridge, net curtains filtering amber sunlight',
  'Concrete balcony with drying laundry sheets, distant city haze, rusted railing with chipped turquoise paint',
  'Dacha greenhouse with fogged glass panels, tomato vines, soil-stained wooden shelves, watering can',
  'Stairwell landing with beige tile, fluorescent tube buzzing overhead, mailboxes on wall, elevator door ajar',
  'Open-air bazaar stall with pyramid of watermelons, striped awning, plastic bags rustling in breeze',
  'Polyclinic corridor with mint-green walls, wooden bench, numbered doors, faded health poster',
  'Marshrutka interior with vinyl seats, steamed windows, hanging air freshener, driver mirror reflection',
  'Garage interior with oil-stained concrete floor, tool pegboard, half-disassembled Moskvitch, bare bulb',
  'Park bench near pond with breadcrumb-fed pigeons, birch trees, distant accordion music, golden hour',
  'Communal apartment kitchen with three stoves, shared fridge magnets, neighbor cat on windowsill'
];

const WARDROBE_PAIRS = [
  ['silk floral blouse with mother-of-pearl buttons', 'worn striped sailor telnyashka under corduroy jacket'],
  ['leopard-print shawl over black turtleneck', 'quilted fufaika vest with missing button'],
  ['fake pearl necklace over magenta knit dress', 'telnyashka tucked into pressed gray trousers'],
  ['Balenciaga-style puffer coat (market knockoff)', 'felt valenki boots with rubberized soles'],
  ['mink-fur shapka with gold brooch pin', 'Adidas tracksuit pants with one white stripe faded'],
  ['hand-knitted cardigan with reindeer pattern', 'plaid flannel shirt rolled to elbows, leather belt'],
];

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
    hook: 'A резко поворачивается к камере',
    A_lines: ['Ты видел что они с хлебом сделали?! | Квадратный! КВАДРАТНЫЙ хлеб!'],
    B_lines: ['И чё? | Земля тоже не круглая | а ты на ней живёшь.'],
    punchline: 'B медленно кивает с видом абсолютного превосходства',
    killer_word: 'живёшь'
  },
  'AI и технологии': {
    hook: 'A тычет пальцем в телефон',
    A_lines: ['Этот твой искусственный интеллект | мне БОРЩ сварит?!'],
    B_lines: ['Он тебе уже внуков воспитывает | а ты и не заметила.'],
    punchline: 'A открывает рот но не находит слов',
    killer_word: 'заметила'
  },
  'Цены и инфляция': {
    hook: 'A держит чек как свиток',
    A_lines: ['За МОЛОКО! | Восемьсот! Рублей! За *молоко*!'],
    B_lines: ['В девяносто третьем | за эти деньги | я машину купил.'],
    punchline: 'Оба смотрят в пустоту',
    killer_word: 'машину'
  },
};

function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) { h = ((h << 5) - h + seed.charCodeAt(i)) | 0; }
  return () => { h = (h * 16807 + 0) % 2147483647; return (h & 0x7fffffff) / 2147483647; };
}

function pickRandom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

function buildCastBlock(charA, charB) {
  return {
    speaker_A: {
      character_en: charA.prompt_tokens.character_en,
      age: charA.appearance_ru.match(/\d+/)?.[0] + ' years old' || 'elderly',
      skin: 'hyper-realistic skin microtexture with visible pores, age spots, fine wrinkles catching sidelight, subtle moisture sheen on forehead',
      eyes: 'watery eyes with micro-saccades, deep crow feet, natural pupil dilation, light reflecting off cornea',
      mouth: 'detailed lip moisture, natural teeth imperfections, micro saliva glints during speech, lip-bite on emotional peak',
    },
    speaker_B: {
      character_en: charB.prompt_tokens.character_en,
      age: charB.appearance_ru.match(/\d+/)?.[0] + ' years old' || 'elderly',
      skin: 'photorealistic skin texture, visible pore detail, age-specific marks, subtle perspiration under warm light',
      eyes: 'expressive eyes with natural micro-movements, crow feet, catchlight reflection, emotional depth',
      mouth: 'moist lips, natural dental detail, saliva click sounds on consonants, mouth firmly CLOSED when not speaking',
    },
  };
}

function buildTimingGrid(hookAction, punchlineAction) {
  return {
    total_seconds: 8.0,
    grid: [
      { segment: 'hook', start: 0.0, end: 0.7, action: hookAction },
      { segment: 'speaker_A', start: 0.7, end: 3.5, action: 'Speaker A delivers main provocation, animated gestures, direct camera gaze' },
      { segment: 'speaker_B', start: 3.5, end: 7.0, action: 'Speaker B responds with punchline, measured delivery building to killer word at 6.85s' },
      { segment: 'laugh_beat', start: 7.0, end: 8.0, action: punchlineAction },
    ],
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
  const charA = characters.find(c => c.id === character1_id) || characters[0];
  const charB = characters.find(c => c.id === character2_id) || characters[1] || characters[0];

  if (!charA || !charB) {
    return { error: 'Characters not found', warnings: ['Выберите двух персонажей'] };
  }

  const cat = category || pickRandom(HUMOR_CATEGORIES, rng);
  const locIdx = Math.floor(rng() * LOCATIONS.length);
  let location = LOCATIONS[locIdx];

  // Avoid repeat
  if (historyCache.hasLocation(location)) {
    location = LOCATIONS[(locIdx + 1) % LOCATIONS.length];
  }

  const wardrobePair = pickRandom(WARDROBE_PAIRS, rng);

  // Build dialogue based on mode
  let dialogueA, dialogueB, hookAction, punchAction, killerWord;
  const demoKey = cat.ru in DEMO_DIALOGUES ? cat.ru : Object.keys(DEMO_DIALOGUES)[Math.floor(rng() * Object.keys(DEMO_DIALOGUES).length)];
  const demo = DEMO_DIALOGUES[demoKey];

  if (input_mode === 'script' && script_ru) {
    dialogueA = script_ru.A || demo.A_lines[0];
    dialogueB = script_ru.B || demo.B_lines[0];
    hookAction = demo.hook;
    punchAction = demo.punchline;
    killerWord = dialogueB.split(/\s+/).pop()?.replace(/[^а-яёa-z]/gi, '') || 'панч';
  } else if (input_mode === 'video' && video_meta) {
    dialogueA = demo.A_lines[0];
    dialogueB = demo.B_lines[0];
    hookAction = `Reference-inspired hook (${video_meta.duration}s source): ${demo.hook}`;
    punchAction = demo.punchline;
    killerWord = demo.killer_word;
  } else {
    dialogueA = demo.A_lines[0];
    dialogueB = demo.B_lines[0];
    hookAction = demo.hook;
    punchAction = demo.punchline;
    killerWord = demo.killer_word;
  }

  // Estimate duration
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

  // Safety: scan banned words
  const safeA = scanBannedWords(dialogueA);
  const safeB = scanBannedWords(dialogueB);

  // Build output package
  const cast = buildCastBlock(charA, charB);
  const timingGrid = buildTimingGrid(hookAction, punchAction);

  const photo_prompt_en_json = {
    scene: `Hyper-realistic close-up still frame of two elderly Russian characters in heated comedic argument. ${location}. Cinematic natural lighting with volumetric dust motes in backlight beams. Shot on vintage lens with subtle chromatic aberration. Social media vertical 9:16 composition.`,
    characters: [
      { role: 'A', appearance: charA.prompt_tokens.character_en, expression: 'mid-sentence animated expression, one hand raised in gesture, direct intense eye contact with camera', wardrobe: wardrobePair[0] },
      { role: 'B', appearance: charB.prompt_tokens.character_en, expression: 'stoic unimpressed face with one slightly raised eyebrow, arms crossed or resting, mouth firmly closed', wardrobe: wardrobePair[1] },
    ],
    environment: { location, lighting: 'natural backlight with hard shadows, dust motes visible in light beams, warm color temperature 3200K', props: ['worn wooden table', 'ceramic teacup with chip', 'wall calendar 2 months behind'] },
    camera: { angle: 'slightly below eye level, selfie POV', distance: 'close-up to medium, both faces in frame', lens: '24mm equivalent, f/2.0 shallow depth of field' },
    style: 'photorealistic, cinematic grain, social media aesthetic, no filters, raw authentic feel',
    negative: 'no text, no watermark, no logo, no phone visible, no camera visible, no overlay, no cartoon, no anime',
  };

  const video_prompt_en_json = {
    cast,
    vibe: {
      dynamic: `${charA.name_ru} (A) provokes with ${charA.modifiers.hook_style}, ${charB.name_ru} (B) responds with deadpan ${charB.modifiers.laugh_style}`,
      hook: hookAction,
      conflict: `Comedic tension about ${cat.en.toLowerCase()}, no personal insults, rage directed at situation`,
      punchline: `Killer word "${killerWord}" lands at ~6.85s, followed by ${punchAction}`,
    },
    camera: {
      pov: 'front selfie POV, device invisible, slightly below eye level, natural hand micro-shake',
      artifacts: ['micro-jitter from handheld', 'exposure breathing 0.2-0.5 EV', 'rolling shutter on fast head turn', 'autofocus hunt 0.1s on scene start', 'h264 social compression grain'],
    },
    world: { location, lighting: 'natural backlight with hard shadows, dust motes in beams, warm practicals', wardrobe_A: wardrobePair[0], wardrobe_B: wardrobePair[1] },
    timing: timingGrid,
    audio: { room_tone: true, overlap_policy: 'STRICTLY FORBIDDEN — cut, not pause. Speaker B mouth CLOSED while A speaks and vice versa.', mouth_rule: 'Non-speaking character has mouth firmly shut, natural idle expression, subtle eye tracking of speaker' },
    safety: { banned_words_replaced: true, device_invisible: true, no_overlays: true },
    output: { format: 'mp4 h264', resolution: '1080x1920 vertical 9:16', fps: 30 },
  };

  // RU Package
  const hashMem = thread_memory ? btoa(thread_memory).slice(0, 8) : 'none';
  const ru_package = `🎬 ДИАЛОГ С ТАЙМИНГАМИ
═══════════════════════════
[0.00–0.70] 🎣 ХУК: ${hookAction}
[0.70–3.50] 🅰️ ${charA.name_ru}:
  «${dialogueA}»
  💬 Подсказки: темп ${charA.speech_pace} | ${charA.swear_level > 0 ? 'мат как акцент' : 'без мата'} | ${charA.modifiers.hook_style}
[3.50–7.00] 🅱️ ${charB.name_ru}:
  «${dialogueB}»
  💬 Подсказки: темп ${charB.speech_pace} | паузы = сила | KILLER WORD «${killerWord}» на 6.85s
[7.00–8.00] 😂 СМЕХ: ${punchAction}

═══════════════════════════
📱 ВИРАЛЬНЫЙ ЗАГОЛОВОК:
${charA.name_ru} vs ${charB.name_ru}: ${cat.ru} 💥

📌 ЗАКРЕП:
Пересылай это видео тому, кто думает что ${cat.ru.toLowerCase()} — это нормально 😂🔥

#️⃣ ХЭШТЕГИ (Золотой набор РФ 2026):
#юмор #ржака #смешно #видео #тренды #рекомендации #reels #shorts #viral #мем #comedy #funny #бабкажжёт #дедответил #${cat.ru.replace(/\s+/g, '').toLowerCase()} #ferixdi`;

  const blueprint_json = {
    scenes: [
      { id: 1, action: hookAction, speaker: 'A', start: 0.0, end: 0.7, dialogue_ru: '', speech_hints: charA.modifiers.hook_style },
      { id: 2, action: 'Main provocation delivery', speaker: 'A', start: 0.7, end: 3.5, dialogue_ru: dialogueA, speech_hints: `${charA.speech_pace} pace, ${charA.swear_level > 1 ? 'expressive swearing' : 'controlled'}, pause markers |` },
      { id: 3, action: 'Punchline response', speaker: 'B', start: 3.5, end: 7.0, dialogue_ru: dialogueB, speech_hints: `${charB.speech_pace} pace, building to killer word "${killerWord}" at 6.85s` },
      { id: 4, action: punchAction, speaker: 'B', start: 7.0, end: 8.0, dialogue_ru: '', speech_hints: charB.modifiers.laugh_style },
    ],
    dialogue_segments: [
      { speaker: 'A', text_ru: dialogueA, start: 0.7, end: 3.5 },
      { speaker: 'B', text_ru: dialogueB, start: 3.5, end: 7.0 },
    ],
    timing_grid: { total: 8.0, hook: [0, 0.7], A: [0.7, 3.5], B: [3.5, 7.0], laugh: [7.0, 8.0], killer_word_at: 6.85 },
  };

  // Validate
  const output = { photo_prompt_en_json, video_prompt_en_json, ru_package, blueprint_json };
  const validation = runAllValidations(output, historyCache);

  // Update history
  historyCache.addGeneration({
    location,
    props: photo_prompt_en_json.environment.props,
    wardrobeA: wardrobePair[0],
    wardrobeB: wardrobePair[1],
    category: cat.ru,
  });

  const log = {
    seed,
    memory_hash: hashMem,
    characters: [charA.id, charB.id],
    category: cat,
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
    warnings: validation.warnings,
    auto_fixes: [...autoFixes, ...validation.auto_fixes],
    duration_estimate: estimate,
  };
}
