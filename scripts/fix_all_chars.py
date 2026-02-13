"""
FERIXDI Studio — Deep Character Fix
Fixes: prompt_tokens.character_en, appearance_ru, signature_words_ru, wardrobe pairs
"""
import json, os, hashlib, random

p = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "data", "characters.json")
with open(p, "r", encoding="utf-8") as f:
    chars = json.load(f)

def h(s):
    return int(hashlib.md5(s.encode()).hexdigest(), 16)

# ═══════════════════════════════════════════
# PHYSICAL APPEARANCE TEMPLATES per group
# ═══════════════════════════════════════════
# Each group has age range, body type options, hair, distinctive features
GROUP_BIOLOGY = {
    "бабки": {
        "age": "88-92", "gender": "woman",
        "body": ["stocky build, wide hips", "thin wiry frame, bony shoulders", "rounded plump figure"],
        "hair": ["thin white hair in tight bun", "silver hair under floral headscarf", "wispy grey hair with visible scalp"],
        "skin": ["deep wrinkles, age spots on cheeks and hands, sagging jowls", "paper-thin translucent skin, prominent veins on temples", "weathered leathery skin, sun damage spots"],
        "eyes": ["small sharp eyes behind thick folds, wet glint", "piercing pale blue eyes, deep crow's feet", "watery brown eyes, drooping lower lids"],
        "nose": ["wide flat nose with visible pores", "sharp beak-like nose, red-tipped", "small upturned nose, broken capillaries"],
        "mouth": ["thin lips, missing teeth gaps, gold crown visible", "pursed wrinkled lips, deep smoker lines", "wide mouth, yellowed teeth, moist lower lip"],
    },
    "деды": {
        "age": "89-93", "gender": "man",
        "body": ["lean sinewy build, stooped posture", "barrel-chested, thick neck", "gaunt angular frame, prominent Adam's apple"],
        "hair": ["bald crown with white fringe, bushy eyebrows", "full head of silver hair combed back", "thin grey wisps, liver-spotted scalp"],
        "skin": ["deeply furrowed forehead, weathered tan, age spots", "pale papery skin, visible blood vessels, sagging under chin", "ruddy complexion, broken capillaries on nose and cheeks"],
        "eyes": ["deep-set eyes under heavy brows, still sharp", "rheumy pale eyes, thick white eyebrows", "bright watchful eyes, crow's feet like river delta"],
        "nose": ["bulbous red-veined nose", "long straight Roman nose, hair in nostrils", "crooked nose (broken once), wide nostrils"],
        "mouth": ["grey stubble, thin firm lips", "full white mustache hiding upper lip", "clean-shaven, slack jaw, visible dentures"],
    },
    "мамы": {
        "age": "45-55", "gender": "woman",
        "body": ["average build, slightly rounded", "tall athletic frame", "petite curvy figure"],
        "hair": ["shoulder-length dyed auburn hair", "short practical bob, dark roots showing", "long dark hair in messy ponytail"],
        "skin": ["smooth olive skin, first crow's feet, forehead lines", "fair freckled skin, laugh lines", "warm tan skin, minimal wrinkles, tired under-eyes"],
        "eyes": ["large expressive brown eyes", "sharp green eyes, always assessing", "dark eyes with permanent worried crease above"],
        "nose": ["straight nose, slightly upturned", "small refined nose", "prominent nose, family feature"],
        "mouth": ["full lips, usually pressed tight", "thin expressive lips, quick to smile", "wide mouth, lipstick slightly smudged"],
    },
    "папы": {
        "age": "48-58", "gender": "man",
        "body": ["solid dad-bod, beer belly", "tall lanky frame, long arms", "compact muscular build going soft"],
        "hair": ["receding hairline, salt-and-pepper", "thick dark hair graying at temples", "crew cut, mostly grey"],
        "skin": ["weathered outdoor skin, forehead creases, five o'clock shadow", "office-pale skin, bags under eyes", "ruddy complexion, razor bumps on neck"],
        "eyes": ["tired but kind brown eyes", "sharp blue eyes behind reading glasses", "squinting eyes, permanent outdoor squint lines"],
        "nose": ["large fleshy nose", "straight nose, broken once playing football", "wide nose, flared nostrils when angry"],
        "mouth": ["thick mustache, firm jaw", "clean-shaven, slightly crooked smile", "stubble, chapped lips, cigarette stain on fingers"],
    },
    "дочери": {
        "age": "18-25", "gender": "woman",
        "body": ["slim athletic build", "average build, soft features", "tall willowy frame"],
        "hair": ["long straight brown hair, phone-selfie ready", "dyed pastel tips, messy waves", "tight curly dark hair"],
        "skin": ["smooth young skin, maybe slight acne on chin", "clear dewy skin, no wrinkles", "light tan, subtle freckles across nose bridge"],
        "eyes": ["big round eyes, smartphone glow reflection", "almond-shaped dark eyes, long lashes", "bright blue eyes, slightly bored expression"],
        "nose": ["small button nose", "delicate straight nose", "upturned nose with nostril piercing"],
        "mouth": ["full lips with lip gloss", "small mouth, braces barely visible", "wide smile, white teeth, always mid-selfie"],
    },
    "сыновья": {
        "age": "17-24", "gender": "man",
        "body": ["skinny, slightly hunched from gaming", "athletic mesomorph, gym bro", "average lanky build, still growing into frame"],
        "hair": ["messy dark hair, hasn't been cut in months", "buzzcut fade, styled top", "curly mop of brown hair"],
        "skin": ["young skin with jaw acne, patchy first beard", "clear skin, defined jawline", "pale indoor skin, dark circles from late nights"],
        "eyes": ["tired eyes from screen time, alert though", "confident brown eyes", "nervous darting eyes, hoodie shadow"],
        "nose": ["straight nose, slightly too big for face", "short nose, flared nostrils", "narrow nose, inherited from mother"],
        "mouth": ["chapped lips, slight overbite", "wide easy grin, white teeth", "tight-lipped, earbuds always in"],
    },
    "тёщи": {
        "age": "60-70", "gender": "woman",
        "body": ["imposing full figure, stands very straight", "compact energetic frame", "heavyset, comfortable in authority"],
        "hair": ["perfectly maintained dyed blonde bob", "silver hair in elegant updo", "dark hair with dramatic grey streak"],
        "skin": ["well-maintained skin, some jowling, pearl earring indents", "thin skin showing veins at temples, powdered cheeks", "tanned leathery from garden work"],
        "eyes": ["sharp evaluating grey eyes behind stylish frames", "small keen eyes, nothing escapes notice", "warm but calculating brown eyes"],
        "nose": ["refined narrow nose, slight downturn", "strong prominent nose, family patriarch", "small nose, flared when disapproving"],
        "mouth": ["thin precise lips, coral lipstick", "wide mouth, controlled smile", "pursed lips, permanent judgmental set"],
    },
    "свекрови": {
        "age": "62-72", "gender": "woman",
        "body": ["dignified upright posture, slender", "stout but impeccably groomed", "tall imposing frame"],
        "hair": ["silver hair in neat chignon, never a strand loose", "dyed dark hair, roots always perfect", "white hair, elegant pearl clips"],
        "skin": ["powdered porcelain skin, controlled aging", "well-preserved, expensive cream texture", "natural aging, proud of every wrinkle"],
        "eyes": ["cool blue eyes, aristocratic distance", "warm brown eyes hiding steel underneath", "sharp grey eyes, reading you like a book"],
        "nose": ["aquiline nose, raised slightly", "small elegant nose", "strong nose, dignified profile"],
        "mouth": ["thin lips with matte rose lipstick", "firm set mouth, rare genuine smile", "polite smile that doesn't reach eyes"],
    },
    "соседи": {
        "age": "40-65", "gender": "man",
        "body": ["stocky with permanent slouch", "average build, always in house clothes", "thin nervous frame"],
        "hair": ["uncombed thinning hair, bed-head", "wild Einstein-white frizz", "neat combover, hat indentation"],
        "skin": ["pasty indoor complexion, stubble patches", "weather-beaten from balcony smoking", "flushed cheeks, broken veins"],
        "eyes": ["suspicious squinty eyes, peephole posture", "curious wide eyes, always watching", "tired bloodshot eyes"],
        "nose": ["large porous nose", "red-tipped drinking nose", "sharp thin nose, always sniffing"],
        "mouth": ["perpetual smirk, crooked teeth", "gap-toothed friendly grin", "tight suspicious mouth, whisperer"],
    },
    "продавцы": {
        "age": "35-55", "gender": "woman",
        "body": ["sturdy imposing figure behind counter", "compact efficient build", "large commanding presence"],
        "hair": ["practical short cut, sometimes net cap", "dyed red hair in tight ponytail", "bleached blonde, dark roots"],
        "skin": ["flour-dusted hands, rosy cheeks from kitchen heat", "rough hands, clean practical nails", "moisturized but tired face"],
        "eyes": ["calculating eyes, instant price assessment", "small shrewd eyes", "tired but alert eyes"],
        "nose": ["broad flat nose", "button nose, reddened from cold market", "sharp nose, sniffing for trouble"],
        "mouth": ["loud voice mouth, gold teeth flash", "tight thin-lipped, prices are final", "wide mouth, constant commentary"],
    },
    "врачи": {
        "age": "45-60", "gender": "man",
        "body": ["slightly overweight, white coat straining", "thin precise movements", "average build, always seated posture"],
        "hair": ["grey at temples, professional cut", "balding, glasses on forehead", "full salt-pepper hair, distinguished"],
        "skin": ["indoor fluorescent pallor, clean-shaven", "dry hands from constant washing", "slight tan, weekend golfer"],
        "eyes": ["analytical eyes behind bifocals", "tired compassionate eyes", "sharp diagnostic gaze, reads symptoms on sight"],
        "nose": ["straight professional nose, glasses mark", "large nose, breath visible in mask memory", "refined nose, always slightly elevated"],
        "mouth": ["thin lips, speaks in diagnoses", "kind mouth, practiced gentle smile", "firm mouth, bad news delivery face"],
    },
    "учителя": {
        "age": "40-60", "gender": "woman",
        "body": ["upright authoritative posture", "slightly hunched from years at blackboard", "energetic compact frame"],
        "hair": ["grey bun with chalk dust", "practical bob with reading glasses on chain", "wild curly hair, pencil stuck in it"],
        "skin": ["chalk-dry hands, glasses indent on nose bridge", "indoor pale, fluorescent lighting skin", "warm brown skin, smile wrinkles"],
        "eyes": ["all-seeing eyes, catches every note-passer", "kind tired eyes behind thick lenses", "sharp reproachful eyes"],
        "nose": ["straight narrow nose, glasses perch mark", "small nose, always slightly red from cold classrooms", "prominent nose, profile of authority"],
        "mouth": ["precise enunciation mouth, thin lips", "wide mouth for projecting across classroom", "teacher smile, encouraging but judging"],
    },
    "блогеры": {
        "age": "22-30", "gender": "woman",
        "body": ["Instagram-ready figure, always posed", "naturally beautiful, zero effort look (lots of effort)", "average but photographed from best angle"],
        "hair": ["perfect blow-out, extensions visible close-up", "natural textured hair, content-ready", "bold colored hair, changes weekly"],
        "skin": ["flawless from ring-light, foundation line at jaw", "actually good skin, barely any makeup", "full contour and highlight, poreless on camera"],
        "eyes": ["wide camera-aware eyes, ring-light reflections", "naturally large eyes, mascara heavy", "cat-eye liner, always slightly squinting for sultry"],
        "nose": ["contoured small nose", "natural nose, unphotoshopped", "button nose, nostril shadow contoured away"],
        "mouth": ["overliner lips, lip filler subtle", "natural full lips, gloss only", "matte lip, practiced smile"],
    },
    "таксисты": {
        "age": "35-55", "gender": "man",
        "body": ["thick-set from sitting all day, strong arms", "lean wiry, nervous energy", "large imposing, fills the driver seat"],
        "hair": ["crew cut, receding", "thick black hair, needs cutting", "bald by choice, tanned scalp"],
        "skin": ["driver's tan on left arm, stubble shadow", "cigarette-yellow fingers, windshield pallor", "weather-beaten from open window driving"],
        "eyes": ["road-weary eyes, mirror-check reflex", "sharp eyes constantly scanning traffic", "tired eyes, red from night shifts"],
        "nose": ["crooked from a fight years ago", "large prominent nose, breathing loud", "flat wide nose, steamed glasses in winter"],
        "mouth": ["perpetual commentary mouth, stained teeth", "tight-lipped, silent judgement in mirror", "wide mouth, stories for every route"],
    },
    "бизнесмены": {
        "age": "35-50", "gender": "man",
        "body": ["gym-maintained, suit-filling build", "thin intense frame, nervous energy", "heavy-set power presence, expensive watch"],
        "hair": ["slicked back, product-heavy", "thinning but expensive cut", "full hair, prematurely grey, owns it"],
        "skin": ["spa-maintained, slight botox shine", "stress-aged beyond years, under-eye bags", "tanned from business trips, clean-shaven"],
        "eyes": ["calculating predator eyes", "exhausted but driven eyes behind designer frames", "confident eyes, never blink first"],
        "nose": ["strong aquiline nose", "sharp pointed nose", "broad nose, nostril flare when negotiating"],
        "mouth": ["thin smile, never real, Rolex-tapping", "tight stressed jaw, teeth grinding visible", "wide confident grin, whitened teeth"],
    },
    "студенты": {
        "age": "18-22", "gender": "man",
        "body": ["skinny, lives on instant noodles", "average unremarkable student build", "slightly overweight, energy drink gut"],
        "hair": ["unwashed two-day hair under hoodie", "trendy undercut, needs touchup", "thick glasses constantly sliding down"],
        "skin": ["stress acne, pale from all-nighters", "young but already has worry lines on forehead", "normal skin, permanent coffee stain on fingers"],
        "eyes": ["red-rimmed from screen, coffee-fueled alertness", "wide confused eyes, lost in bureaucracy", "squinting without glasses, forgot them again"],
        "nose": ["unremarkable nose, sometimes running", "sharp nose, always in a textbook", "broken nose from freshman party"],
        "mouth": ["chapped lips, always explaining something", "nervous bitten lips", "wide mouth, never stops talking in lectures"],
    },
    "пенсионеры": {
        "age": "70-85", "gender": "man",
        "body": ["dignified thinning frame, once tall", "barrel-chested, refusing to age", "bent by arthritis, walks with cane"],
        "hair": ["distinguished white hair, military neat", "wild white Einstein hair, professor type", "thin white fringe, newsboy cap over it"],
        "skin": ["weathered with dignity, deep forehead lines", "liver spots on hands and temples, papery thin", "ruddy healthy complexion despite age"],
        "eyes": ["wise calm eyes, seen everything", "bright curious eyes behind thick glasses", "milky blue eyes, still piercing"],
        "nose": ["large distinguished nose, character defining", "red bulbous nose, warmth indicator", "thin straight nose, aristocratic remnant"],
        "mouth": ["firm set jaw, generation that doesn't complain", "gentle smile lines, dentures clicking", "stern mouth, medals-wearing posture"],
    },
    "чиновники": {
        "age": "45-60", "gender": "man",
        "body": ["paunchy, desk-bound spread", "rigidly upright, Soviet posture training", "large imposing behind desk"],
        "hair": ["combover hiding nothing, hair spray shellac", "short bureaucratic cut, grey", "dyed suspiciously dark for age"],
        "skin": ["indoor pallid, fluorescent office tan", "slightly sweaty, pen-stained fingers", "suspiciously well-maintained for salary"],
        "eyes": ["flat bureaucratic eyes, stamp-ready", "small suspicious eyes, looking over glasses", "dead fish eyes, zero empathy detected"],
        "nose": ["average nose, glasses indent permanent", "bulbous red nose, suspicious flush", "thin pinched nose, disapproving angle"],
        "mouth": ["tight-lipped, information is power", "rubbery smile, practiced insincerity", "straight line mouth, signature-ready"],
    },
    "фитнес": {
        "age": "25-40", "gender": "woman",
        "body": ["toned athletic build, always in motion", "muscular CrossFit body, visible abs", "yoga-flexible, lean elongated frame"],
        "hair": ["high ponytail, sweat-damp tendrils", "short practical pixie cut", "braided for workout, colorful scrunchie"],
        "skin": ["flushed post-workout glow, clear skin", "tanned outdoor runner skin", "clean skin, water-drinking discipline"],
        "eyes": ["bright energetic eyes, motivational stare", "competitive fierce eyes", "zen calm eyes, judging your posture"],
        "nose": ["small straight nose, breathing efficient", "athletic straight nose", "button nose, slightly flared from cardio"],
        "mouth": ["wide motivational smile, white teeth", "firm determined lips", "protein-shake stained lips, always talking macros"],
    },
    "кошатницы": {
        "age": "50-70", "gender": "woman",
        "body": ["soft round figure, cat-hair covered", "thin birdlike frame, always carrying a cat", "average build, apron permanent"],
        "hair": ["messy grey bun, cat hair accessories", "frizzy brown hair, hasn't been styled since cats", "white hair, always a cat sleeping on shoulder"],
        "skin": ["soft warm skin, cat scratch marks on hands", "dry hands, multiple band-aids from cat claws", "indoor pale, warm gentle complexion"],
        "eyes": ["warm gentle eyes, slightly crazy gleam", "wide eyes, always worried about cats", "soft brown eyes, ultimate kindness, permanent concern"],
        "nose": ["small round nose, cat-nuzzle ready", "pink-tipped from cold (keeping windows open for cats)", "thin nose, always sniffing for cat food freshness"],
        "mouth": ["gentle smile, talking in baby voice to cats", "worried mouth, listing cat medications", "wide warm smile, purring sounds when happy"],
    },
    "экстремалы": {
        "age": "25-40", "gender": "man",
        "body": ["compact muscular, scar collection", "lean endurance-athlete build, weathered", "tall rangy, rope-calloused hands"],
        "hair": ["sun-bleached wild hair, salt-crusted", "shaved head, helmet-dent tan line", "long tied-back hair, wind-tangled"],
        "skin": ["deep permanent tan, white goggle marks", "wind-burned, cracked lips, sun damage", "scarred forearms, adventure-tattooed"],
        "eyes": ["adrenaline-bright, never fully relaxed", "squinting from permanent sun exposure", "wild excited eyes, always scanning for next thrill"],
        "nose": ["broken twice, slightly off-center", "sun-peeled nose bridge", "wind-weathered, broken capillaries"],
        "mouth": ["wide grinning, chipped front tooth", "cracked sun-blistered lips", "laughing mouth, missing lateral tooth from incident"],
    },
}

# Default for groups not listed above
DEFAULT_BIO = {
    "age": "40-60", "gender": "person",
    "body": ["average build", "sturdy frame", "lean build"],
    "hair": ["dark hair, practical style", "grey hair", "thinning hair"],
    "skin": ["weathered skin, lived-in face", "indoor complexion", "natural skin texture"],
    "eyes": ["expressive eyes", "sharp observant eyes", "tired but alert eyes"],
    "nose": ["distinctive nose", "average nose", "prominent nose"],
    "mouth": ["expressive mouth", "thin determined lips", "wide mouth"],
}

# Wardrobe pairs (A material, B material) — contrasting textures
WARDROBE_FULL = {
    "A": [
        "silk floral blouse with mother-of-pearl buttons, velvet collar",
        "leopard-print chiffon shawl over black cashmere turtleneck",
        "faux-pearl necklace over embroidered magenta kaftan dress",
        "fake-fur-trimmed burgundy coat, gold brooch on lapel",
        "bright hand-knitted mohair cardigan with reindeer pattern",
        "sequined evening top (worn ironically at 9am), silk scarf",
        "vintage brocade jacket, costume jewelry rings on every finger",
        "oversized designer-knockoff puffer, rhinestone sunglasses pushed up",
    ],
    "B": [
        "worn striped sailor telnyashka under patched corduroy jacket, leather belt",
        "quilted cotton fufaika vest, one button missing, wool undershirt visible",
        "faded plaid flannel shirt rolled to elbows, leather watch strap",
        "grey wool sweater with moth holes, collar of white shirt peeking out",
        "old military field jacket, medals pinned crookedly, woolen scarf",
        "denim work overalls over thermal undershirt, oil stain on knee",
        "track suit bottoms, wool socks in sandals, oversized knit sweater",
        "brown leather work apron over striped shirt, sawdust on shoulders",
    ],
}

# Signature words per group  
SIGNATURE_WORDS = {
    "бабки": [["батюшки", "ой", "нет ну ты гляди"], ["мать моя", "кошмар", "а я говорила"], ["вот в наше время", "это ж надо", "караул"]],
    "деды": [["э нет", "стоп", "я те щас объясню"], ["база", "факт", "без вариантов"], ["слушай сюда", "короче так", "в моё время"]],
    "мамы": [["я же говорила", "вот видишь", "ну и что дальше"], ["сколько можно", "опять", "ладно хватит"], ["послушай меня", "я знаю лучше", "мне виднее"]],
    "папы": [["так", "ладно", "нормально"], ["бывает", "ничего страшного", "я разберусь"], ["спокойно", "сейчас починим", "дай гляну"]],
    "дочери": [["вааау", "серьёзно?!", "ну ма-а-ам"], ["лол", "кринж", "это база"], ["окей бумер", "фу", "я не понимаю"]],
    "сыновья": [["чё", "норм", "ща"], ["братан", "лол", "изи"], ["ну типа", "прикинь", "жёстко"]],
    "тёщи": [["доченька", "я только хотела", "а вот мой зять"], ["между прочим", "я ведь предупреждала", "вот помяни моё слово"], ["а в нашей семье", "я конечно молчу но", "ну раз ты так решил"]],
    "свекрови": [["милая", "ну что ж", "а мой сын"], ["в приличных семьях", "мы так не делали", "ну ладно пусть будет"], ["конечно конечно", "я не вмешиваюсь но", "а вот у Ивановых"]],
    "соседи": [["а я вчера видел", "вы слышали", "а чё это у вас"], ["между прочим", "я вам скажу", "вот люди пошли"], ["тише надо", "опять шумите", "я в управляющую"]],
}

def pick(arr, seed):
    return arr[seed % len(arr)]

for c in chars:
    seed = h(c["id"])
    grp = c["group"]
    bio = GROUP_BIOLOGY.get(grp, DEFAULT_BIO)
    
    body = pick(bio["body"], seed)
    hair = pick(bio["hair"], seed + 1)
    skin_desc = pick(bio["skin"], seed + 2)
    eyes = pick(bio["eyes"], seed + 3)
    nose = pick(bio["nose"], seed + 4)
    mouth = pick(bio["mouth"], seed + 5)
    age = bio["age"]
    gender = bio.get("gender", "person")
    
    # Build real Veo prompt token
    c["prompt_tokens"]["character_en"] = (
        f"{age} year old Russian {gender}, {body}, "
        f"{hair}, {skin_desc}, {eyes}, {nose}, {mouth}, "
        f"hyper-realistic skin microtexture with visible pores, "
        f"natural imperfections, photorealistic detail"
    )
    
    # Fix appearance_ru  
    name = c["name_ru"]
    c["appearance_ru"] = (
        f"{name}: {age} лет, {body.split(',')[0]}. "
        f"Волосы: {hair.split(',')[0]}. Кожа: {skin_desc.split(',')[0]}. "
        f"Глаза: {eyes.split(',')[0]}. Нос: {nose.split(',')[0]}. Рот: {mouth.split(',')[0]}."
    )
    
    # Fix signature_words_ru
    grp_words = SIGNATURE_WORDS.get(grp, [["ну", "вот", "ладно"], ["так", "значит", "понятно"]])
    c["signature_words_ru"] = pick(grp_words, seed)
    
    # Fix wardrobe to full description
    role = c["role_default"]
    wardrobe_pool = WARDROBE_FULL.get(role, WARDROBE_FULL["B"])
    c["identity_anchors"]["wardrobe_anchor"] = pick(wardrobe_pool, seed)
    
    # Add biology_override with proper age/skin for non-elderly
    if grp not in ("бабки", "деды", "пенсионеры"):
        c["biology_override"] = {
            "age": age,
            "skin_tokens": [s.strip() for s in skin_desc.split(",")[:3]],
            "eye_tokens": [e.strip() for e in eyes.split(",")[:2]],
        }

with open(p, "w", encoding="utf-8") as f:
    json.dump(chars, f, ensure_ascii=False, indent=1)

print(f"Deep-fixed {len(chars)} characters: prompt_tokens, appearance_ru, signature_words, wardrobe")
