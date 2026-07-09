import { classifyByText } from './utils.js';

const REMOTE_MODEL_ENDPOINT = import.meta.env.VITE_MODEL_API_URL || '';

const categoryHints = [
  {
    category: '证件',
    tags: ['卡片', '证件'],
    patterns: ['card', 'credit card', 'id', 'wallet', 'pass', 'license']
  },
  {
    category: '电子产品',
    tags: ['电子产品'],
    patterns: ['cellular telephone', 'cell phone', 'mobile phone', 'laptop', 'computer', 'keyboard', 'mouse', 'ipod', 'remote control', 'earphone', 'headphone']
  },
  {
    category: '书本资料',
    tags: ['书本资料'],
    patterns: ['book', 'notebook', 'binder', 'envelope', 'packet', 'paper', 'comic book']
  },
  {
    category: '衣物',
    tags: ['衣物'],
    patterns: ['jersey', 'sweatshirt', 'coat', 'suit', 'shirt', 'sock', 'glove', 'hat', 'cap', 'backpack']
  },
  {
    category: '钥匙',
    tags: ['钥匙'],
    patterns: ['key', 'chain', 'padlock']
  },
  {
    category: '校园卡',
    tags: ['校园卡', '卡片'],
    patterns: ['card', 'credit card', 'id card']
  },
  {
    category: '雨伞',
    tags: ['雨伞'],
    patterns: ['umbrella']
  },
  {
    category: '水杯',
    tags: ['水杯'],
    patterns: ['water bottle', 'bottle', 'cup', 'mug']
  }
];

let modelPromise = null;

function getModel() {
  if (!modelPromise) {
    modelPromise = Promise.all([
      import('@tensorflow/tfjs'),
      import('@tensorflow-models/mobilenet')
    ]).then(async ([tf, mobilenet]) => {
      await tf.setBackend('cpu');
      await tf.ready();
      return mobilenet.load({ version: 2, alpha: 1.0 });
    });
  }
  return modelPromise;
}

function unique(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeRemoteData(raw = {}) {
  const payload = raw && raw.data && !raw.category && !raw.aiTags ? raw.data : raw;
  const tags = unique([]
    .concat(payload.aiTags || [])
    .concat(payload.tags || [])
    .concat(payload.semanticTags || [])
    .concat(payload.objects || [])
    .concat(payload.yoloObjects || []));
  return {
    title: payload.title || payload.name || '',
    description: payload.description || payload.visualDescription || payload.caption || '',
    category: payload.category || '',
    tags,
    visualDescription: payload.visualDescription || payload.description || payload.caption || '',
    rawPredictions: payload.rawPredictions || []
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function compressDataUrl(dataUrl, maxSize = 1024, quality = 0.76) {
  return imageFromDataUrl(dataUrl).then((image) => {
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  });
}

function classifyPredictions(predictions = [], hint = '') {
  const source = predictions.map((entry) => entry.className).join(' ').toLowerCase();
  const hinted = classifyByText(hint);
  if (hinted.confidence > 0) return { ...hinted, confidence: Math.max(hinted.confidence, 0.72) };

  for (const rule of categoryHints) {
    if (rule.patterns.some((pattern) => source.includes(pattern))) {
      return {
        category: rule.category,
        tags: unique([rule.category, ...rule.tags]),
        confidence: Math.max(predictions[0]?.probability || 0.5, 0.58)
      };
    }
  }

  return { category: '其他', tags: ['待确认'], confidence: predictions[0]?.probability || 0 };
}

function fallbackByText(hint = '') {
  const classification = classifyByText(hint);
  return {
    title: classification.category,
    description: classification.confidence > 0 ? `根据文字线索识别为${classification.category}` : '图片已上传，物品特征待确认',
    category: classification.category,
    tags: classification.tags || ['待确认'],
    visualDescription: classification.confidence > 0 ? `根据文字线索识别为${classification.category}` : '图片已上传，物品特征待确认',
    rawPredictions: []
  };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

async function classifyViaRemote(dataUrl, hint) {
  if (!REMOTE_MODEL_ENDPOINT) return null;
  const compressed = await compressDataUrl(dataUrl);
  const response = await fetch(REMOTE_MODEL_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      imageBase64: compressed.replace(/^data:[^,]+,/, ''),
      mimeType: 'image/jpeg',
      hint
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }
  return normalizeRemoteData(body.ok ? body.data : body);
}

async function classifyViaBrowser(dataUrl, hint) {
  const image = await imageFromDataUrl(dataUrl);
  const model = await withTimeout(getModel(), 18000, '浏览器识别模型加载超时');
  const predictions = await withTimeout(model.classify(image, 5), 12000, '浏览器识别超时');
  const classification = classifyPredictions(predictions, hint);
  const readable = predictions
    .slice(0, 3)
    .map((entry) => entry.className.split(',')[0])
    .join('、');
  return {
    title: classification.category,
    description: readable ? `图片可能包含：${readable}` : '',
    category: classification.category,
    tags: unique([...(classification.tags || []), ...predictions.slice(0, 3).map((entry) => entry.className.split(',')[0])]),
    visualDescription: readable ? `图片可能包含：${readable}` : '',
    rawPredictions: predictions
  };
}

export async function recognizeImageFile(file, hint = '') {
  const dataUrl = await fileToDataUrl(file);
  const textHint = `${hint || ''} ${file?.name || ''}`.trim();
  try {
    const remote = await classifyViaRemote(dataUrl, textHint);
    if (remote) return { image: dataUrl, data: remote, source: 'remote' };
  } catch (error) {
    try {
      const browser = await classifyViaBrowser(dataUrl, textHint);
      return {
        image: dataUrl,
        data: browser,
        source: 'browser',
        warning: `远程识别不可用，已改用浏览器识别：${error.message || '接口调用失败'}`
      };
    } catch (browserError) {
      return {
        image: dataUrl,
        data: fallbackByText(textHint),
        source: 'text',
        warning: `图片模型暂时不可用，已根据文字线索预填：${browserError.message || '模型加载失败'}`
      };
    }
  }
  try {
    const browser = await classifyViaBrowser(dataUrl, textHint);
    return { image: dataUrl, data: browser, source: 'browser' };
  } catch (error) {
    return {
      image: dataUrl,
      data: fallbackByText(textHint),
      source: 'text',
      warning: `图片模型暂时不可用，已根据文字线索预填：${error.message || '模型加载失败'}`
    };
  }
}
