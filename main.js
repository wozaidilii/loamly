const canvas = document.querySelector("#signal-canvas");
const context = canvas?.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let width = 0;
let height = 0;
let nodes = [];
let animationFrame = 0;

const translations = {
  en: {
    pageTitle: "Loamly | Living Internet Worlds",
    pageDescription: "Loamly builds living internet worlds across anime, AI, community, and future media.",
    skip: "Skip to projects",
    navMission: "Mission",
    navProjects: "Projects",
    navFounder: "Leadership",
    navCareers: "Career",
    navContact: "Contact",
    domainLine: "www.loamly.net / operating signal",
    heroTitle: "Loamly builds living internet worlds.",
    heroText:
      "We design media systems where stories, characters, communities, and software behave less like pages and more like places people return to.",
    heroPrimary: "Enter Anime",
    heroSecondary: "Talk to Kai",
    heroPhotoLabel: "CEO / Founder",
    missionKicker: "Loamly doctrine",
    missionTitle: "Media is no longer a file. It is an environment.",
    missionCopy1:
      "Loamly is building a new operating layer for fan culture: an interface where anime, AI agents, community memory, and creator workflows converge into one persistent world.",
    missionCopy2:
      "We are not trying to make another content feed. Feeds are disposable. Worlds compound. Characters gain history, communities gain language, and every launch becomes infrastructure for the next mythology.",
    missionCopy3:
      "The first public signal is Anime. The larger ambition is a network of cultural software: precise, multilingual, emotionally charged, and built for people who think the internet should still feel dangerous in the best way.",
    capabilitiesKicker: "System layers",
    capabilitiesTitle: "A company for worlds that need software, taste, and velocity.",
    capabilitiesLead:
      "The public surface is simple. Behind it is a studio model for shipping cultural products fast: story, product, growth, and technical operations moving as one.",
    cap1Title: "Narrative infrastructure",
    cap1Copy: "World bibles, character systems, lore loops, and launch surfaces designed to survive beyond a single campaign.",
    cap2Title: "AI-native interaction",
    cap2Copy:
      "Agents, memory, multilingual response, and automation patterns that make a project feel alive without burying users in machinery.",
    cap3Title: "Community signal design",
    cap3Copy:
      "Systems for conversation, moderation, identity, and high-context fandom where people do not feel like traffic.",
    cap4Title: "Launch operations",
    cap4Copy:
      "The unromantic work: speed, analytics, support, documentation, and the boring reliability that makes strange ideas real.",
    projectsKicker: "Project directory",
    projectsTitle: "The first world is live. The next ones are being prepared.",
    projectsLead:
      "Loamly projects share a single spine: cinematic presentation, technical discipline, and communities that can grow into their own language.",
    projectLive: "Live channel",
    animeCopy:
      "The first Loamly world: an anime-focused destination built for discovery, immersion, and the next generation of fan-native interfaces.",
    animeAction: "Open Anime",
    reserved: "Reserved slot",
    nextProject: "Next Project",
    futureChannel: "Future Channel",
    pending: "Pending signal",
    reservedCopy1: "A future Loamly channel is being shaped here. It will not appear until it earns the slot.",
    reservedCopy2:
      "Additional worlds will join the network when the mythology, product, and operation are ready.",
    leadershipKicker: "Leadership signal",
    founderTitle: "Led by people who prefer building worlds to explaining decks.",
    founderCopy:
      "Loamly is directed by Kai, with a bias toward fast prototypes, cinematic product taste, and systems that feel slightly too ambitious until they ship.",
    founderQuote:
      "We do not want a polite internet. We want worlds with memory, pressure, beauty, and users who feel like they found a signal before everyone else.",
    careerKicker: "Career",
    careersTitle: "We are looking for people who recognize the signal.",
    careersLead:
      "Loamly is not hiring for ordinary resumes. We are looking for collaborators who can build, ship, write, design, operate, and obsess with unusual intensity.",
    careerRole1: "World builders",
    careerCopy1:
      "Product-minded engineers, AI tinkerers, designers, writers, operators, and growth people who can move between taste and execution.",
    careerRole2: "Co-conspirators",
    careerCopy2:
      "People who care about anime, internet culture, multilingual communities, and products that feel like they were not approved by committee.",
    careerAction: "Send a signal",
    contactKicker: "Contact matrix",
    contactTitle: "For partnerships, support, and unusual proposals.",
    contactCeo: "CEO / Partnerships",
    contactSupport: "Technical support",
    contactAnime: "Live project",
    footerLeft: "Loamly / Living Internet Worlds",
    footerRight: "© 2026 Loamly. All signal reserved.",
  },
  ja: {
    pageTitle: "Loamly | 生きているインターネット世界",
    pageDescription: "Loamly は、アニメ、AI、コミュニティ、未来のメディアを横断する生きたインターネット世界を構築しています。",
    skip: "プロジェクトへ移動",
    navMission: "ミッション",
    navProjects: "プロジェクト",
    navFounder: "リーダー",
    navCareers: "採用",
    navContact: "連絡先",
    domainLine: "www.loamly.net / 稼働シグナル",
    heroTitle: "Loamly は、生きているインターネット世界をつくる。",
    heroText:
      "物語、キャラクター、コミュニティ、ソフトウェアが、ただのページではなく、人が戻ってくる場所として振る舞うメディアシステムを設計しています。",
    heroPrimary: "Anime に入る",
    heroSecondary: "Kai に連絡",
    heroPhotoLabel: "CEO / Founder",
    missionKicker: "Loamly の思想",
    missionTitle: "メディアはもうファイルではない。環境である。",
    missionCopy1:
      "Loamly は、ファンカルチャーのための新しいオペレーティングレイヤーを構築しています。アニメ、AI エージェント、コミュニティの記憶、クリエイターのワークフローが、ひとつの持続する世界へ収束するインターフェースです。",
    missionCopy2:
      "私たちは、またひとつのコンテンツフィードを作りたいわけではありません。フィードは消費されます。世界は蓄積されます。キャラクターは履歴を持ち、コミュニティは言語を持ち、すべてのローンチは次の神話のインフラになります。",
    missionCopy3:
      "最初の公開シグナルは Anime です。より大きな野心は、精密で、多言語で、感情を帯びた文化ソフトウェアのネットワークをつくること。インターネットは、まだ良い意味で危険であるべきだと信じる人のために。",
    capabilitiesKicker: "システムレイヤー",
    capabilitiesTitle: "ソフトウェア、審美眼、速度を必要とする世界のための会社。",
    capabilitiesLead:
      "公開されている表面はシンプルです。その裏側には、物語、プロダクト、成長、技術運用を一体で動かすカルチャープロダクトのスタジオモデルがあります。",
    cap1Title: "物語インフラ",
    cap1Copy: "世界観設計、キャラクターシステム、ロアループ、単発キャンペーンで終わらないローンチ面を構築します。",
    cap2Title: "AI ネイティブな対話",
    cap2Copy:
      "エージェント、記憶、多言語応答、自動化パターンにより、機械を前面に出しすぎず、プロジェクトが生きている感覚をつくります。",
    cap3Title: "コミュニティ信号設計",
    cap3Copy:
      "会話、モデレーション、アイデンティティ、高文脈なファンダムのための仕組み。人をトラフィックとして扱わない設計です。",
    cap4Title: "ローンチ運用",
    cap4Copy:
      "速度、分析、サポート、ドキュメント、そして奇妙なアイデアを現実にするための退屈な信頼性を担います。",
    projectsKicker: "プロジェクト一覧",
    projectsTitle: "最初の世界は公開済み。次の世界は準備中。",
    projectsLead:
      "Loamly のプロジェクトは、映画的な表現、技術的な規律、そして独自の言語へ育つコミュニティという同じ背骨を持っています。",
    projectLive: "公開中",
    animeCopy:
      "Loamly 最初の世界。発見、没入、そして次世代のファンネイティブなインターフェースのために作られた Anime プロジェクトです。",
    animeAction: "Anime を開く",
    reserved: "予約枠",
    nextProject: "次のプロジェクト",
    futureChannel: "未来のチャンネル",
    pending: "準備中",
    reservedCopy1: "未来の Loamly チャンネルをここで形成しています。ふさわしい状態になるまで公開されません。",
    reservedCopy2: "神話、プロダクト、運用がそろったとき、次の世界がネットワークに接続されます。",
    leadershipKicker: "リーダーシップ",
    founderTitle: "資料を説明するより、世界を作ることを好む人間が率いる。",
    founderCopy:
      "Loamly は Kai によって率いられています。高速な試作、映画的なプロダクト感覚、そして出荷されるまでは少し野心的すぎるように見えるシステムを重視します。",
    founderQuote:
      "礼儀正しいだけのインターネットはいらない。記憶、圧力、美しさがあり、誰よりも早く信号を見つけたと感じられる世界をつくりたい。",
    careerKicker: "採用",
    careersTitle: "私たちは、信号を認識できる仲間を探しています。",
    careersLead:
      "Loamly は普通の履歴書のために採用していません。作り、出荷し、書き、設計し、運用し、異常な密度で執着できる協力者を探しています。",
    careerRole1: "世界を作る人",
    careerCopy1:
      "プロダクト志向のエンジニア、AI の実験者、デザイナー、ライター、オペレーター、グロース担当。審美眼と実行の間を移動できる人。",
    careerRole2: "共犯者",
    careerCopy2:
      "アニメ、インターネット文化、多言語コミュニティ、そして委員会で承認されたようには見えないプロダクトを愛する人。",
    careerAction: "シグナルを送る",
    contactKicker: "連絡先",
    contactTitle: "提携、サポート、そして普通ではない提案のために。",
    contactCeo: "CEO / Partnership",
    contactSupport: "技術サポート",
    contactAnime: "公開プロジェクト",
    footerLeft: "Loamly / Living Internet Worlds",
    footerRight: "© 2026 Loamly. All signal reserved.",
  },
  zh: {
    pageTitle: "Loamly | 活着的互联网世界",
    pageDescription: "Loamly 正在构建横跨动漫、AI、社区与未来媒体的活着的互联网世界。",
    skip: "跳转到项目",
    navMission: "使命",
    navProjects: "项目",
    navFounder: "团队",
    navCareers: "招聘",
    navContact: "联系",
    domainLine: "www.loamly.net / 运行信号",
    heroTitle: "Loamly 构建活着的互联网世界。",
    heroText:
      "我们设计的媒体系统，让故事、角色、社区与软件不再像一次性页面，而更像人们会反复返回的场所。",
    heroPrimary: "进入 Anime",
    heroSecondary: "联系 Kai",
    heroPhotoLabel: "CEO / Founder",
    missionKicker: "Loamly 信条",
    missionTitle: "媒体不再是文件。它是一种环境。",
    missionCopy1:
      "Loamly 正在为粉丝文化构建新的操作层：一个让动漫、AI Agent、社区记忆与创作者工作流汇聚到同一个持续世界中的界面。",
    missionCopy2:
      "我们不是要再做一个内容信息流。信息流会被消费，世界会积累。角色会拥有历史，社区会生成语言，每一次发布都会成为下一个神话的基础设施。",
    missionCopy3:
      "第一个公开信号是 Anime。更大的野心，是构建一个精准、多语言、带有情绪张力的文化软件网络，为仍然相信互联网应该保留一点危险魅力的人而建。",
    capabilitiesKicker: "系统层",
    capabilitiesTitle: "一家为世界构建软件、审美与速度的公司。",
    capabilitiesLead:
      "外部看到的界面很简单。背后是一种高速交付文化产品的工作室模型：故事、产品、增长和技术运营一起移动。",
    cap1Title: "叙事基础设施",
    cap1Copy: "世界观手册、角色系统、设定循环与发布界面，目标是让项目不止活过一次活动周期。",
    cap2Title: "AI 原生交互",
    cap2Copy:
      "Agent、记忆、多语言响应与自动化模式，让项目显得有生命，但不把用户埋进机器感里。",
    cap3Title: "社区信号设计",
    cap3Copy:
      "为对话、治理、身份和高语境粉丝社区设计系统，让人不只是流量。",
    cap4Title: "发布运营",
    cap4Copy:
      "速度、分析、支持、文档，以及把奇怪想法变成现实所需的可靠性。",
    projectsKicker: "项目目录",
    projectsTitle: "第一个世界已经上线。下一个正在准备。",
    projectsLead:
      "Loamly 项目共享同一条脊柱：电影感呈现、技术纪律，以及能成长出自己语言的社区。",
    projectLive: "已上线",
    animeCopy:
      "Loamly 的第一个世界：一个围绕动漫、发现、沉浸与下一代粉丝原生界面构建的目的地。",
    animeAction: "打开 Anime",
    reserved: "预留位置",
    nextProject: "下一个项目",
    futureChannel: "未来频道",
    pending: "信号准备中",
    reservedCopy1: "未来的 Loamly 频道正在这里成形。只有当它配得上这个位置时才会出现。",
    reservedCopy2: "当神话、产品和运营都准备好，更多世界会接入这个网络。",
    leadershipKicker: "领导团队",
    founderTitle: "由更喜欢构建世界、而不是解释 PPT 的人来带队。",
    founderCopy:
      "Loamly 由 Kai 主导方向，并由 CTO 驱动技术系统。我们偏好快速原型、电影化产品审美，以及那些在发布前看起来略显过分野心的系统。",
    founderQuote:
      "我们不想要一个过分礼貌的互联网。我们想要有记忆、有压迫感、有美感的世界，让用户觉得自己比所有人更早发现了信号。",
    careerKicker: "招聘",
    careersTitle: "我们在寻找能识别信号的伙伴。",
    careersLead:
      "Loamly 不为普通简历招聘。我们寻找能构建、发布、写作、设计、运营，并以异常强度投入的合作者。",
    careerRole1: "世界构建者",
    careerCopy1:
      "产品型工程师、AI 实验者、设计师、写作者、运营者和增长型人才，能够在审美和执行之间切换。",
    careerRole2: "同频共犯",
    careerCopy2:
      "关心动漫、互联网文化、多语言社区，以及那些看起来不像委员会批准过的产品的人。",
    careerAction: "发送信号",
    contactKicker: "联系矩阵",
    contactTitle: "用于合作、支持，以及不寻常的提案。",
    contactCeo: "CEO / 合作",
    contactSupport: "技术支持",
    contactAnime: "已上线项目",
    footerLeft: "Loamly / Living Internet Worlds",
    footerRight: "© 2026 Loamly. All signal reserved.",
  },
};

function cssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function resizeCanvas() {
  if (!canvas || !context) return;

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const count = Math.max(34, Math.min(82, Math.floor((width * height) / 17000)));
  nodes = Array.from({ length: count }, (_, index) => {
    const band = index % 4;
    return {
      x: (index * 149) % Math.max(width, 1),
      y: ((index * 97) % Math.max(height, 1)) + band * 12,
      size: 1 + (index % 3) * 0.45,
      drift: 0.12 + (index % 5) * 0.025,
      phase: index * 0.72,
    };
  });
}

function draw(timestamp = 0) {
  if (!canvas || !context) return;

  const accent = cssColor("--accent", "oklch(0.78 0.14 205)");
  const accentDim = cssColor("--accent-dim", "oklch(0.54 0.09 205)");
  const primary = cssColor("--primary-strong", "oklch(0.57 0.17 5)");

  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = "lighter";

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const movement = reducedMotion.matches ? 0 : timestamp * 0.00008 * node.drift;
    const x = (node.x + movement * width + Math.sin(timestamp * 0.0004 + node.phase) * 8) % width;
    const y = (node.y + Math.cos(timestamp * 0.00032 + node.phase) * 10 + height) % height;

    context.fillStyle = index % 5 === 0 ? primary : accent;
    context.globalAlpha = index % 5 === 0 ? 0.38 : 0.26;
    context.beginPath();
    context.arc(x, y, node.size, 0, Math.PI * 2);
    context.fill();

    for (let next = index + 1; next < nodes.length; next += 1) {
      const other = nodes[next];
      const otherX = (other.x + movement * width * 0.78) % width;
      const otherY = (other.y + height) % height;
      const distance = Math.hypot(x - otherX, y - otherY);

      if (distance < 150) {
        context.strokeStyle = index % 4 === 0 ? primary : accentDim;
        context.globalAlpha = Math.max(0, (150 - distance) / 150) * 0.12;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(otherX, otherY);
        context.stroke();
      }
    }
  }

  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;

  if (!reducedMotion.matches) {
    animationFrame = window.requestAnimationFrame(draw);
  }
}

function restart() {
  window.cancelAnimationFrame(animationFrame);
  resizeCanvas();
  draw();
  if (!reducedMotion.matches) {
    animationFrame = window.requestAnimationFrame(draw);
  }
}

function setLanguage(language) {
  const lang = translations[language] ? language : "en";
  const dictionary = translations[lang];

  document.documentElement.lang = lang;
  document.title = dictionary.pageTitle;
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute("content", dictionary.pageDescription);
  }

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (key && dictionary[key]) {
      element.textContent = dictionary[key];
    }
  });

  document.querySelectorAll("[data-lang-option]").forEach((button) => {
    const selected = button.getAttribute("data-lang-option") === lang;
    button.setAttribute("aria-pressed", String(selected));
  });

  try {
    window.localStorage.setItem("loamly-language", lang);
  } catch {
    // Language still switches; persistence is only a convenience.
  }
}

function initialLanguage() {
  try {
    const saved = window.localStorage.getItem("loamly-language");
    if (saved && translations[saved]) return saved;
  } catch {
    // Ignore storage access failures.
  }
  const browserLanguage = navigator.language.toLowerCase();
  if (browserLanguage.startsWith("zh")) return "zh";
  return browserLanguage.startsWith("ja") ? "ja" : "en";
}

document.querySelectorAll("[data-lang-option]").forEach((button) => {
  button.addEventListener("click", () => {
    setLanguage(button.getAttribute("data-lang-option"));
  });
});

window.addEventListener("resize", restart, { passive: true });
if (typeof reducedMotion.addEventListener === "function") {
  reducedMotion.addEventListener("change", restart);
} else if (typeof reducedMotion.addListener === "function") {
  reducedMotion.addListener(restart);
}

setLanguage(initialLanguage());
restart();
