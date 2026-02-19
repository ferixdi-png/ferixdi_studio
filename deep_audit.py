import re, json

html = open('app/index.html', 'r', encoding='utf-8').read()
js = open('app/main.js', 'r', encoding='utf-8').read()
d = json.load(open('app/data/course.json', 'r', encoding='utf-8'))
errors = []

# ═══ 1. course.json DEEP VALIDATION ═══
print("=" * 60)
print("1. COURSE.JSON DEEP VALIDATION")
print("=" * 60)

# Lessons
for i, L in enumerate(d.get('lessons', [])):
    for f in ['id', 'num', 'title', 'duration', 'bullets', 'content', 'deliverables']:
        if f not in L or not L[f]:
            errors.append(f"Lesson {i} ({L.get('title','')}): missing/empty '{f}'")
    if 'content' in L and len(L['content']) == 0:
        errors.append(f"Lesson {i}: empty content array")
    if 'bullets' in L and len(L['bullets']) == 0:
        errors.append(f"Lesson {i}: empty bullets array")
print(f"  Lessons: {len(d.get('lessons', []))}")

# FAQ
faq = d.get('faq', [])
for i, f in enumerate(faq):
    if not f.get('q', '').strip(): errors.append(f"FAQ {i}: empty question")
    if not f.get('a', '').strip(): errors.append(f"FAQ {i}: empty answer")
print(f"  FAQ: {len(faq)}")

# Stop-list
sl = d.get('stop_list', [])
for i, s in enumerate(sl):
    for f in ['mistake', 'why_kills', 'fix']:
        if f not in s or not s[f]: errors.append(f"Stop-list {i}: missing '{f}'")
print(f"  Stop-list: {len(sl)}")

# Checklists
chk = d.get('checklists', {})
total_chk = 0
for k, items in chk.items():
    if len(items) == 0: errors.append(f"Checklist '{k}': empty")
    total_chk += len(items)
print(f"  Checklists: {len(chk)} ({total_chk} items)")

# Character guide
cg = d.get('character_guide', {})
for i, s in enumerate(cg.get('steps', [])):
    for f in ['num', 'title', 'text']:
        if f not in s: errors.append(f"CharGuide step {i}: missing '{f}'")
for i, n in enumerate(cg.get('niche_examples', [])):
    for f in ['niche', 'formula', 'why']:
        if f not in n: errors.append(f"CharGuide niche {i}: missing '{f}'")
print(f"  CharGuide: {len(cg.get('steps',[]))} steps, {len(cg.get('niche_examples',[]))} niches")

# Publishing guide
pg = d.get('publishing_guide', {})
if not pg: errors.append("publishing_guide: MISSING from course.json")
else:
    if not pg.get('schedule_by_geo'): errors.append("publishing_guide: missing schedule_by_geo")
    if not pg.get('frequency_rules'): errors.append("publishing_guide: missing frequency_rules")
    if not pg.get('algorithm_rules'): errors.append("publishing_guide: missing algorithm_rules")
    if not pg.get('missed_day_protocol'): errors.append("publishing_guide: missing missed_day_protocol")
    print(f"  PubGuide: {len(pg.get('schedule_by_geo',[]))} GEOs, {len(pg.get('frequency_rules',[]))} freq, {len(pg.get('algorithm_rules',[]))} algo, {len(pg.get('missed_day_protocol',[]))} missed")

# Profile guide
pfg = d.get('profile_guide', {})
if not pfg: errors.append("profile_guide: MISSING from course.json")
else:
    for i, e in enumerate(pfg.get('elements', [])):
        for f in ['element', 'icon', 'bad', 'good', 'why', 'tip']:
            if f not in e: errors.append(f"ProfileGuide element {i}: missing '{f}'")
    if not pfg.get('checklist'): errors.append("profile_guide: missing checklist")
    print(f"  ProfileGuide: {len(pfg.get('elements',[]))} elements, {len(pfg.get('checklist',[]))} checklist items")

# Other sections
print(f"  Study plan: {len(d.get('study_plan', []))}")
print(f"  Mindset: {len(d.get('mindset_rules', []))}")
print(f"  Benefits: {len(d.get('benefits', []))}")
print(f"  Definitions: {len(d.get('definitions', []))}")
print(f"  Timeline: {len(d.get('timeline', []))}")

# ═══ 2. HTML ↔ JS WIRING ═══
print()
print("=" * 60)
print("2. HTML <-> JS WIRING")
print("=" * 60)

html_ids = sorted(set(re.findall(r'id="(edu-[^"]+)"', html)))
html_lesson_ids = sorted(set(re.findall(r'id="(lesson-modal[^"]*)"', html)))
all_html_ids = html_ids + html_lesson_ids

js_refs = set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", js))
edu_js = sorted([i for i in js_refs if i.startswith('edu-') or i.startswith('lesson-modal')])

# JS refs not in HTML
for i in edu_js:
    if f'id="{i}"' not in html:
        errors.append(f"JS ref NOT in HTML: {i}")

# HTML IDs not in JS (skip container-only IDs)
container_only = {'edu-quick-nav'}
for i in all_html_ids:
    if i in container_only: continue
    if f'"{i}"' not in js and f"'{i}'" not in js:
        errors.append(f"HTML ID NOT in JS: {i}")

print(f"  HTML edu- IDs: {len(html_ids)}")
print(f"  HTML lesson-modal IDs: {len(html_lesson_ids)}")
print(f"  JS edu-/lesson- refs: {len(edu_js)}")

# ═══ 3. NEW FEATURES CHECK ═══
print()
print("=" * 60)
print("3. NEW FEATURES CHECK")
print("=" * 60)

features = {
    'progress_dashboard': 'edu-progress-dashboard' in html and 'updateEduProgress' in js,
    'progress_bar': 'edu-progress-bar' in html,
    'quick_nav_5_buttons': html.count('edu-nav-btn') >= 5,
    'lesson_read_tracking': 'ferixdi_lessons_read' in js and '_markLessonRead' in js,
    'prev_next_modal': 'lesson-modal-prev' in html and 'lesson-modal-next' in html,
    'arrow_keys': 'ArrowLeft' in js and 'ArrowRight' in js,
    'pub_guide_render': 'edu-pub-guide-wrap' in html and 'publishing_guide' in js,
    'profile_guide_render': 'edu-profile-guide-wrap' in html and 'profile_guide' in js,
    'updates_block': 'постоянно обновляется' in html,
    'telegram_channel': 'ferixdi_ai' in html,
    'checklist_progress': 'updateEduProgress' in js,
    'stop_list_collapse': 'STOP_PREVIEW' in js,
}
for k, v in features.items():
    status = "OK" if v else "X MISSING"
    if not v: errors.append(f"FEATURE MISSING: {k}")
    print(f"  {k}: {status}")

# ═══ 4. CROSS-CHECK LANDING ═══
print()
print("=" * 60)
print("4. CROSS-CHECK WITH LANDING")
print("=" * 60)

try:
    landing = open('C:/Users/User/Downloads/ПРОЕКТИК/landing/index.html', 'r', encoding='utf-8').read()
    checks = {
        'lessons': (len(d['lessons']), len(re.findall(r'(\d+) урок', landing))),
        'faq': (len(d['faq']), landing.count('104')),
        'stop_list': (len(d['stop_list']), len(re.findall(r'50 ошиб', landing))),
        'checklists': (len(d['checklists']), len(re.findall(r'6 чекл', landing))),
    }
    for k, (actual, mentions) in checks.items():
        num_in_landing = re.findall(r'(\d+) ' + ('урок' if k=='lessons' else 'FAQ' if k=='faq' else 'ошиб' if k=='stop_list' else 'чекл'), landing)
        for n in num_in_landing:
            if int(n) != actual:
                errors.append(f"CROSS-CHECK {k}: landing says {n} but course.json has {actual}")
        print(f"  {k}: course.json={actual}, landing mentions={mentions}")
except Exception as e:
    print(f"  Landing not found: {e}")

# ═══ 5. CONTENT QUALITY: 8-SEC ALGORITHM ═══
print()
print("=" * 60)
print("5. CONTENT QUALITY: 8-SEC ALGORITHM COVERAGE")
print("=" * 60)

content_all = ' '.join([' '.join(L.get('content', [])) for L in d.get('lessons', [])])
key_topics = {
    '8 секунд / формат': bool(re.search(r'8.секунд', content_all)),
    'хук / крючок 0.3 сек': bool(re.search(r'крюч|хук|hook|0\.3.сек', content_all, re.IGNORECASE)),
    'удержание / retention': bool(re.search(r'удержани|retention', content_all, re.IGNORECASE)),
    'пересылки / shares': bool(re.search(r'пересылк|share|forward', content_all, re.IGNORECASE)),
    'WinnerScore': 'WinnerScore' in content_all,
    'серийность': bool(re.search(r'серийн|серия|серии', content_all, re.IGNORECASE)),
    'персонажи A/B': bool(re.search(r'персонаж|A/B|A и B', content_all)),
    'регулярность': bool(re.search(r'регулярн|ежедневн|каждый день', content_all, re.IGNORECASE)),
    'конструктор персонажей': bool(re.search(r'конструктор', content_all, re.IGNORECASE)),
    'Smart Match': 'Smart Match' in content_all,
    'QC Gate': 'QC Gate' in content_all or 'QC' in content_all,
    'монетизация': bool(re.search(r'монетиз|заработ', content_all, re.IGNORECASE)),
    'воронка': bool(re.search(r'воронк', content_all, re.IGNORECASE)),
    'алгоритм Instagram': bool(re.search(r'алгоритм', content_all, re.IGNORECASE)),
}
for topic, found in key_topics.items():
    status = "OK" if found else "X NOT FOUND"
    if not found: errors.append(f"CONTENT GAP: '{topic}' not found in lessons")
    print(f"  {topic}: {status}")

# PubGuide coverage
pub_content = json.dumps(d.get('publishing_guide', {}), ensure_ascii=False)
pub_topics = {
    'время по ГЕО': 'Россия' in pub_content and 'США' in pub_content,
    'частота': 'posts_per_week' in pub_content,
    'пропуск дня': 'Пропустил' in pub_content,
    'алгоритм регулярности': 'бонус регулярности' in pub_content or 'регулярн' in pub_content.lower(),
}
print()
print("  Publishing Guide:")
for topic, found in pub_topics.items():
    status = "OK" if found else "X"
    print(f"    {topic}: {status}")

# Profile guide coverage
prof_content = json.dumps(d.get('profile_guide', {}), ensure_ascii=False)
prof_topics = {
    'аватар': 'Аватар' in prof_content,
    'bio / описание': 'Bio' in prof_content,
    'ссылка в bio': 'Ссылка' in prof_content,
    'хайлайты': 'Хайлайт' in prof_content,
    'закрепы': 'Закреп' in prof_content,
    'CTA': 'CTA' in prof_content,
    'до/после формат': 'bad' in prof_content and 'good' in prof_content,
}
print()
print("  Profile Guide:")
for topic, found in prof_topics.items():
    status = "OK" if found else "X"
    print(f"    {topic}: {status}")

# ═══ FINAL REPORT ═══
print()
print("=" * 60)
print(f"ERRORS: {len(errors)}")
print("=" * 60)
if errors:
    for e in errors:
        print(f"  X {e}")
else:
    print("  OK ZERO ERRORS - EVERYTHING IS CLEAN")
print()
print("AUDIT COMPLETE")
