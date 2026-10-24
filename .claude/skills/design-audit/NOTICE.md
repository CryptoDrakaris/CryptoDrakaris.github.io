# Источники и лицензии

Правила этого скила частично пересказаны своими словами и изменены по материалам открытых проектов. Тексты правил не скопированы; ниже – источники, их лицензии и пометки, по которым правило видно в `references/`.

| Пометка | Источник | Что взято | Лицензия |
|---|---|---|---|
| без пометки (разделы 1–8 `web.md`) | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | объективные нормы веб-интерфейсов, отобраны и переписаны для веба | MIT, Copyright (c) 2024 Next Level Builder |
| раздел `taste.md` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | правила «шаблонности и вкуса», не привязанные к стеку | MIT, Copyright (c) 2026 Leonxlnx |
| ⓙ | [jakubkrehel/skills](https://github.com/jakubkrehel/skills), скилы `better-*` | правила доступности, раскладки, цвета, типографики, текстов и полировки; принципы оценки (лестница серьёзности, доказательства, дешёвое исправление) | MIT, Copyright (c) 2026 Jakub Krehel |
| Ⓐ | [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins), папка `design/` (плагин «Design») | процесс критики, вопросы перед аудитом, работа по макету, правила текстов интерфейса и состояний | Apache License 2.0, Copyright Anthropic, PBC |
| Ⓐ | [anthropics/skills](https://github.com/anthropics/skills): `frontend-design`, `canvas-design`, `slack-gif-creator`, `webapp-testing` | правила вкуса, графики и анимации, ошибки консоли | Apache License 2.0, Copyright 2026 Anthropic, PBC |
| ⓝ | [zanwei/design-dna](https://github.com/zanwei/design-dna) | замер последовательности: уникальные значения и частоты, слияние близких цветов по ΔE (CIE Lab), сверка с каноном и его покрытие; пороги ΔE 3, 5 и 20. Код не копировался: `color-delta.mjs` написан по опубликованным формулам CIEDE2000 (Sharma, Wu, Dalal, 2005), зависимость sharp не используется | MIT, Copyright (c) 2026 the design-dna authors |
| ⓤ | [AThevon/genjutsu](https://github.com/AThevon/genjutsu) | организация проверки: три исхода (находка, чисто, не применимо), приметы шаблонности под замысел и их запись, независимые линзы на одном пакете доказательств, цикл исправлений с потолком раундов | MIT, Copyright (c) 2026 Adrien Thevon |
| ⓖ | [greensock/gsap-skills](https://github.com/greensock/gsap-skills) | проверки готовых сайтов на GSAP и ScrollTrigger | MIT, Copyright (c) 2026 GreenSock |
| ⓣ | [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) | производительность WebGL и вес 3D-моделей; правила доступности canvas (`canvas-*`) написаны для этого скила по WCAG 2.2 | MIT, Copyright (c) 2026 CloudAI-X |
| ⓛ | [lottiefiles/motion-design-skill](https://github.com/lottiefiles/motion-design-skill) | качество движения: кривые, каскады, длительности, вестибулярные риски. Пороги источника без ссылок на исследования, поэтому приоритеты не выше MEDIUM; `motion-exit-shorter` сверено с Material Design | MIT, Copyright (c) 2025 LottieFiles |
| ⓓ | встроенный скил Claude Code `dataviz` | правила графиков и дашбордов | лицензия в источнике не указана: правила изложены своими словами, скрипт не копировался – `palette-check.mjs` написан заново по опубликованным формулам OKLab (B. Ottosson, 2020) и Machado, Oliveira, Fernandes (2009) |

**Изменения относительно источников** (Apache License 2.0, п. 4(b)): правила пересказаны на русском языке, отобраны, объединены с правилами других источников, снабжены своими ID, приоритетами и способами проверки, а нормы сверены с WCAG 2.2. Файла NOTICE в источниках Apache нет.

**Не использовались:** закрытые скилы Anthropic `docx`, `pdf`, `pptx`, `xlsx` – их лицензия запрещает копии и производные работы. Правила для слайдов и документов сформулированы по общепринятой практике, проверки написаны своим кодом.

Тексты лицензий:

- MIT: https://opensource.org/license/mit
- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0

Скил не одобрен Anthropic, PBC и не связан с ней; упоминание Anthropic – только указание источника.
