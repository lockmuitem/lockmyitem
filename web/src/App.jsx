import { useEffect, useMemo, useState } from 'react';
import { campusMapImage, campusMapImageBoundaries, campusMapMeta, categories, locationAliases, locations } from './data.js';
import {
  claimCloudItem,
  clearUser,
  cloudErrorMessage,
  createCloudComment,
  createCloudItem,
  createItem,
  loadCloudItemDetail,
  loadCloudItems,
  loadItems,
  loadUser,
  loginWithEmailCode,
  loginWithEmailPassword,
  registerWithEmail,
  saveItems,
  saveUser,
  sendEmailCode,
  setCloudReturnStatus
} from './store.js';
import { classifyByText, findPotentialMatches, formatDate, getLocation, semanticSearchItems } from './utils.js';
import { recognizeImageFile } from './vision.js';
import campusBoardImage from './assets/notice/campus-board.jpg';
import doneIcon from './assets/tabbar/done.png';
import doneActiveIcon from './assets/tabbar/done-active.png';
import foundIcon from './assets/tabbar/found.png';
import foundActiveIcon from './assets/tabbar/found-active.png';
import meIcon from './assets/tabbar/me.png';
import meActiveIcon from './assets/tabbar/me-active.png';
import searchIcon from './assets/tabbar/search.png';
import searchActiveIcon from './assets/tabbar/search-active.png';

const tabItems = [
  { key: 'found', text: '失物招领', icon: foundIcon, activeIcon: foundActiveIcon },
  { key: 'lost', text: '寻物', icon: searchIcon, activeIcon: searchActiveIcon },
  { key: 'returned', text: '已找到', icon: doneIcon, activeIcon: doneActiveIcon },
  { key: 'me', text: '我的', icon: meIcon, activeIcon: meActiveIcon }
];

const SCHOOL_EMAIL_DOMAIN = 'shanghaitech.edu.cn';
const EMAIL_CODE_COOLDOWN_SECONDS = 30;
const LOCATION_DETAIL_HINT = '可补充入口、楼层、靠窗/靠路侧、附近标志物等细节。';

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true;
}

function pwaGuideLines() {
  if (typeof navigator === 'undefined') {
    return ['在浏览器菜单中选择“添加到主屏幕”或“添加到桌面”。'];
  }
  const userAgent = navigator.userAgent || '';
  if (/MicroMessenger/i.test(userAgent)) {
    return [
      '点击右上角“…”菜单，先选择“在浏览器打开”。',
      '在浏览器菜单中选择“添加到桌面”或“添加到主屏幕”。'
    ];
  }
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return [
      '点击底部分享按钮。',
      '选择“添加到主屏幕”，确认名称后保存。'
    ];
  }
  return [
    '点击浏览器菜单里的“添加到主屏幕”或“添加到桌面”。',
    '添加后可以从手机桌面直接打开 LockMyItem。'
  ];
}

function locationImageHint(location) {
  return [
    `${location?.name || ''} ${location?.area || ''}`.trim(),
    '这是失物招领发布页的方位补充图片。',
    '请只描述图片中可帮助定位的空间线索，例如入口、楼层、门牌、靠窗/靠路侧、桌椅、楼梯、电梯、附近标志物。',
    '不要重复地点名称和地点区域，用一句简体中文概括。'
  ].filter(Boolean).join(' ');
}

function locationDetailFromRecognition(data = {}, location) {
  const source = [
    data.visualDescription,
    data.description,
    data.caption,
    data.title,
    ...(data.tags || []),
    ...(data.semanticTags || [])
  ].filter(Boolean).join('，').trim();
  if (!source) return '';

  const prefixes = [
    `${location.name}，${location.area}；`,
    `${location.name}，${location.area}。`,
    `${location.name}，${location.area}`,
    `${location.name}，`,
    `${location.name}；`,
    `${location.name}。`,
    location.name
  ].filter(Boolean);

  const matchedPrefix = prefixes.find((prefix) => source.startsWith(prefix));
  const text = (matchedPrefix ? source.slice(matchedPrefix.length) : source)
    .replace(/^(图片中|画面中|图中|这是一张|这张图片显示|图片显示|可以看到)/, '')
    .replace(/^[，,；;。、\s]+/, '')
    .trim();
  if (!text || ['其他', '待识别物品', '待确认'].includes(text)) return '';
  return /[。.!！?？]$/.test(text) ? text : `${text}。`;
}

function App() {
  const [items, setItems] = useState(() => loadItems());
  const [currentUser, setCurrentUser] = useState(() => loadUser());
  const [view, setView] = useState('found');
  const [activeCategory, setActiveCategory] = useState('全部');
  const [selectedId, setSelectedId] = useState(null);
  const [detailReturnTarget, setDetailReturnTarget] = useState(null);
  const [publishDraft, setPublishDraft] = useState(null);
  const [commentsByItem, setCommentsByItem] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [claimingItemId, setClaimingItemId] = useState(null);
  const [toast, setToast] = useState('');
  const [authPrompt, setAuthPrompt] = useState(null);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [showPwaGuide, setShowPwaGuide] = useState(false);

  useEffect(() => {
    saveItems(items);
  }, [items]);

  useEffect(() => {
    let cancelled = false;
    setSyncing(true);
    loadCloudItems()
      .then((cloudItems) => {
        if (cancelled) return;
        setItems(cloudItems);
        setToast('已同步云端公告栏');
      })
      .catch((error) => {
        if (cancelled) return;
        setToast(`云端同步失败，正在使用本机缓存：${cloudErrorMessage(error)}`);
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (view !== 'detail' || !selectedId) return undefined;
    let cancelled = false;
    loadCloudItemDetail(selectedId)
      .then(({ item, comments }) => {
        if (cancelled) return;
        if (item) {
          setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, ...item } : entry)));
        }
        setCommentsByItem((current) => ({ ...current, [selectedId]: comments }));
      })
      .catch((error) => {
        if (!cancelled) setToast(`评论同步失败：${cloudErrorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [view, selectedId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredInstallPrompt(event);
    }

    function handleAppInstalled() {
      setDeferredInstallPrompt(null);
      setShowPwaGuide(false);
      setToast('已添加到桌面');
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const stats = useMemo(() => {
    const active = items.filter((item) => item.status === 'active');
    return {
      found: active.filter((item) => item.type === 'found').length,
      lost: active.filter((item) => item.type === 'lost').length,
      returned: items.filter((item) => item.status === 'returned').length,
      total: items.length,
      active: active.length
    };
  }, [items]);

  const selectedItem = items.find((item) => item.id === selectedId);

  function openDetail(id, returnTarget = null) {
    setSelectedId(id);
    setDetailReturnTarget(returnTarget);
    setView('detail');
  }

  function openTab(key) {
    setActiveCategory('全部');
    setSelectedId(null);
    setDetailReturnTarget(null);
    setPublishDraft(null);
    setView(key);
  }

  function requireAuth(actionLabel, onAuthed, onCancel) {
    if (currentUser) {
      onAuthed(currentUser);
      return;
    }
    setAuthPrompt({ actionLabel, onAuthed, onCancel });
  }

  function openAuthPanel() {
    setAuthPrompt({ actionLabel: '登录/注册' });
  }

  function openPublish(type = 'found') {
    requireAuth(type === 'lost' ? '发布寻物' : '发布招领', () => {
      setSelectedId(null);
      setDetailReturnTarget(null);
      setPublishDraft(null);
      setView(type === 'lost' ? 'publish-lost' : 'publish-found');
    });
  }

  function openMatchDetailFromPublish(id, draft) {
    const nextDraft = {
      ...draft,
      tags: [...(draft.tags || [])],
      rawPredictions: [...(draft.rawPredictions || [])],
      locationImages: [...(draft.locationImages || [])]
    };
    setPublishDraft(nextDraft);
    openDetail(id, {
      view: nextDraft.type === 'lost' ? 'publish-lost' : 'publish-found',
      scrollY: window.scrollY
    });
  }

  function openMatchDetailFromDetail(id) {
    if (!selectedItem || selectedItem.id === id) return;
    openDetail(id, {
      view: 'detail',
      itemId: selectedItem.id,
      scrollY: window.scrollY,
      parent: detailReturnTarget
    });
  }

  function backFromDetail() {
    if (detailReturnTarget?.view === 'detail' && detailReturnTarget.itemId) {
      const scrollY = detailReturnTarget.scrollY || 0;
      setSelectedId(detailReturnTarget.itemId);
      setDetailReturnTarget(detailReturnTarget.parent || null);
      setView('detail');
      window.requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      return;
    }
    if (detailReturnTarget?.view?.startsWith('publish')) {
      const scrollY = detailReturnTarget.scrollY || 0;
      setSelectedId(null);
      setDetailReturnTarget(null);
      setView(detailReturnTarget.view);
      window.requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
      return;
    }
    openTab(selectedItem.status === 'returned' ? 'returned' : selectedItem.type);
  }

  async function publishItem(payload) {
    const nextPayload = {
      ...payload,
      ownerName: currentUser?.nickName || payload.ownerName,
      title: payload.title || (payload.type === 'lost' ? '未命名寻物' : '未命名招领'),
      description: payload.description || '暂无补充描述'
    };
    let nextItem;
    let cloudSynced = true;
    try {
      nextItem = await createCloudItem(nextPayload, currentUser);
    } catch (error) {
      cloudSynced = false;
      nextItem = createItem(nextPayload);
      console.warn('Cloud publish failed; saved locally.', error);
    }
    setItems((current) => [nextItem, ...current]);
    setSelectedId(null);
    setDetailReturnTarget(null);
    setPublishDraft(null);
    setActiveCategory('全部');
    setView(payload.type === 'lost' ? 'lost' : 'found');
    if (cloudSynced) {
      setToast(payload.type === 'lost' ? '已同步发布寻物' : '已同步发布招领');
    } else {
      setToast('云端发布失败，已暂存本机');
    }
  }

  function submitClaim(item) {
    if (claimingItemId) return;
    requireAuth('认领物品', async (user) => {
      setClaimingItemId(item.id);
      const claimedAt = new Date().toISOString();
      const fallbackItem = {
        ...item,
        status: 'returned',
        returnedAt: claimedAt,
        claimedAt,
        claimantName: user.nickName,
        claimantContact: user.contact,
        claims: [
          ...(item.claims || []),
          {
            id: `claim_${Date.now()}`,
            userId: user.id,
            nickName: user.nickName,
            contact: user.contact,
            createdAt: claimedAt
          }
        ]
      };
      try {
        const { item: claimedItem, comment } = await claimCloudItem(item.id, user);
        const nextItem = claimedItem || fallbackItem;
        setItems((current) => current.map((entry) => (entry.id === item.id ? nextItem : entry)));
        if (comment) {
          setCommentsByItem((current) => ({
            ...current,
            [item.id]: [...(current[item.id] || []), comment]
          }));
        }
        setToast('认领成功，物品已移入已找到');
      } catch (error) {
        setItems((current) => current.map((entry) => (
          entry.id === item.id
            ? fallbackItem
            : entry
        )));
        setToast(`云端认领失败，已暂存本机：${cloudErrorMessage(error)}`);
      } finally {
        setClaimingItemId(null);
      }
    });
  }

  async function handleAuthSubmit(authPayload) {
    let user;
    if (authPayload.mode === 'register') {
      user = await registerWithEmail(authPayload);
    } else if (authPayload.method === 'code') {
      user = await loginWithEmailCode(authPayload);
    } else {
      user = await loginWithEmailPassword(authPayload);
    }
    saveUser(user);
    setCurrentUser(user);
    const pending = authPrompt?.onAuthed;
    setAuthPrompt(null);
    setToast('已登录');
    if (pending) window.setTimeout(() => pending(user), 0);
  }

  async function installDesktopApp() {
    if (isStandaloneDisplay()) {
      setToast('已经在桌面端模式运行');
      return;
    }

    if (!deferredInstallPrompt) {
      setShowPwaGuide(true);
      return;
    }

    const promptEvent = deferredInstallPrompt;
    setDeferredInstallPrompt(null);
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        setToast('正在添加到桌面');
      } else {
        setShowPwaGuide(true);
      }
    } catch (error) {
      setShowPwaGuide(true);
    }
  }

  function logout() {
    clearUser();
    setCurrentUser(null);
    setToast('已退出登录');
  }

  async function markReturned(id) {
    try {
      await setCloudReturnStatus(id, true);
      setItems((current) => current.map((item) => (
        item.id === id
          ? {
              ...item,
              status: 'returned',
              returnedAt: new Date().toISOString(),
              claimedAt: null,
              claimedByOpenid: '',
              claimantName: '',
              claimantContact: ''
            }
          : item
      )));
      setToast('已同步为找回');
    } catch (error) {
      setToast(`云端状态更新失败：${cloudErrorMessage(error)}`);
    }
  }

  async function undoReturned(id) {
    try {
      await setCloudReturnStatus(id, false);
      setItems((current) => current.map((item) => (
        item.id === id
          ? {
              ...item,
              status: 'active',
              returnedAt: null,
              claimedAt: null,
              claimedByOpenid: '',
              claimantName: '',
              claimantContact: ''
            }
          : item
      )));
      setToast('已同步撤回');
    } catch (error) {
      setToast(`云端状态更新失败：${cloudErrorMessage(error)}`);
    }
  }

  function submitComment(item, content) {
    return new Promise((resolve) => {
      requireAuth('发表评论', async (user) => {
        try {
          const comment = await createCloudComment(item.id, content, user);
          setCommentsByItem((current) => ({
            ...current,
            [item.id]: [...(current[item.id] || []), comment]
          }));
          setToast('评论已同步');
          resolve(true);
        } catch (error) {
          setToast(`评论同步失败：${cloudErrorMessage(error)}`);
          resolve(false);
        }
      }, () => resolve(false));
    });
  }

  const showTabBar = ['found', 'lost', 'returned', 'me'].includes(view);

  return (
    <main className="app-root">
      {view === 'found' && (
        <FoundPage
          items={items}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          total={stats.found}
          onPublish={() => openPublish('found')}
          onOpen={openDetail}
          onInstallDesktop={installDesktopApp}
        />
      )}

      {view === 'lost' && (
        <LostPage
          items={items}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          total={stats.lost}
          onPublish={() => openPublish('lost')}
          onOpen={openDetail}
          onInstallDesktop={installDesktopApp}
        />
      )}

      {view === 'returned' && (
        <ReturnedPage
          items={items}
          total={stats.returned}
          onOpen={openDetail}
        />
      )}

      {view === 'me' && (
        <MePage
          items={items}
          stats={stats}
          currentUser={currentUser}
          onPublish={() => openPublish('found')}
          onOpen={openDetail}
          onMarkReturned={markReturned}
          onUndoReturned={undoReturned}
          onLogin={openAuthPanel}
          onLogout={logout}
        />
      )}

      {view.startsWith('publish') && (
        <PublishPage
          initialType={view === 'publish-lost' ? 'lost' : 'found'}
          initialDraft={publishDraft}
          items={items}
          currentUser={currentUser}
          onCancel={() => openTab(view === 'publish-lost' ? 'lost' : 'found')}
          onSubmit={publishItem}
          onOpenMatch={openMatchDetailFromPublish}
        />
      )}

      {view === 'detail' && selectedItem && (
        <DetailPage
          item={selectedItem}
          items={items}
          comments={commentsByItem[selectedItem.id] || []}
          onBack={backFromDetail}
          claiming={claimingItemId === selectedItem.id}
          onClaim={() => submitClaim(selectedItem)}
          onMarkReturned={() => markReturned(selectedItem.id)}
          onUndoReturned={() => undoReturned(selectedItem.id)}
          onComment={(content) => submitComment(selectedItem, content)}
          onOpenMatch={openMatchDetailFromDetail}
        />
      )}

      {syncing && <div className="sync-chip" role="status">同步中</div>}
      {showTabBar && (
        <TabBar
          view={view}
          onChange={openTab}
          onPublish={() => openPublish(view === 'lost' ? 'lost' : 'found')}
        />
      )}
      {authPrompt && (
        <AuthModal
          actionLabel={authPrompt.actionLabel}
          onClose={() => {
            authPrompt.onCancel?.();
            setAuthPrompt(null);
          }}
          onSendCode={sendEmailCode}
          onSubmit={handleAuthSubmit}
        />
      )}
      {showPwaGuide && <PwaInstallGuide onClose={() => setShowPwaGuide(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function FoundPage({ items, activeCategory, setActiveCategory, total, onPublish, onOpen, onInstallDesktop }) {
  const [semanticQuery, setSemanticQuery] = useState('');
  const baseList = filterItems(items, 'found', 'active', activeCategory);
  const list = semanticSearchItems(baseList, semanticQuery);
  return (
    <section className="page found-page">
      <div className="board-head">
        <div>
          <h1 className="app-title">失物招领平台</h1>
          <p className="app-subtitle">上海科技大学</p>
        </div>
        <PwaInstallButton tone="found" onClick={onInstallDesktop} />
      </div>

      <button className="notice-banner" type="button" onClick={onPublish}>
        <div className="notice-copy">
          <strong className="notice-title">拾金不昧，传递温暖</strong>
          <span className="notice-subtitle">如遇失物，请及时发布招领信息</span>
        </div>
        <img className="notice-image" src={campusBoardImage} alt="" />
      </button>

      <SemanticSearchBox
        value={semanticQuery}
        onChange={setSemanticQuery}
        tone="found"
        resultCount={list.length}
        totalCount={baseList.length}
        placeholder="语义搜索：黑色雨伞、图书馆耳机、红色挂件..."
      />

      <CategoryBar value={activeCategory} onChange={setActiveCategory} tone="found" />

      {list.length > 0 && (
        <div className="section-bar">
          <div>
            <h2 className="list-title">近期拾到 · {total} 条</h2>
            <p className="list-subtitle">按最新发布排序</p>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">{semanticQuery.trim() ? '没有匹配的招领信息' : '暂时没有招领信息'}</div>
      ) : (
        <FeedPanel items={list} kind="found" onOpen={onOpen} />
      )}

      <div className="safety-note">
        <span className="shield-dot" />
        <span>温馨提示：请勿发布他人隐私信息，招领成功后请及时下架。</span>
      </div>

    </section>
  );
}

function LostPage({ items, activeCategory, setActiveCategory, total, onPublish, onOpen, onInstallDesktop }) {
  const [semanticQuery, setSemanticQuery] = useState('');
  const baseList = filterItems(items, 'lost', 'active', activeCategory);
  const list = semanticSearchItems(baseList, semanticQuery);
  return (
    <section className="page lost-page">
      <div className="board-head">
        <div>
          <h1 className="app-title">寻物登记</h1>
          <p className="app-subtitle">丢失物品后，先登记线索再等待匹配提醒</p>
        </div>
        <PwaInstallButton tone="lost" onClick={onInstallDesktop} />
      </div>

      <button className="notice-banner lost" type="button" onClick={onPublish}>
        <img className="notice-image" src={campusBoardImage} alt="" />
        <div className="notice-copy">
          <strong className="notice-title">丢了东西，先留下线索</strong>
          <span className="notice-subtitle">{total} 条寻物正在等待匹配</span>
        </div>
      </button>

      <SemanticSearchBox
        value={semanticQuery}
        onChange={setSemanticQuery}
        tone="lost"
        resultCount={list.length}
        totalCount={baseList.length}
        placeholder="语义搜索：校园卡、二食堂水杯、蓝色钥匙..."
      />

      <CategoryBar value={activeCategory} onChange={setActiveCategory} tone="lost" />

      {list.length > 0 && (
        <div className="section-bar">
          <div>
            <h2 className="list-title">正在寻找 · {total} 条</h2>
            <p className="list-subtitle">同学发布的寻物线索</p>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">{semanticQuery.trim() ? '没有匹配的寻物信息' : '暂时没有寻物信息'}</div>
      ) : (
        <FeedPanel items={list} kind="lost" onOpen={onOpen} />
      )}

    </section>
  );
}

function ReturnedPage({ items, total, onOpen }) {
  const list = items
    .filter((item) => item.status === 'returned')
    .sort((a, b) => new Date(b.returnedAt || b.createdAt) - new Date(a.returnedAt || a.createdAt));

  return (
    <section className="page returned-page">
      <div className="board-head">
        <h1 className="app-title">已找到</h1>
        <p className="app-subtitle">归还成功的物品会留在这里，避免重复认领。</p>
      </div>

      <div className="summary-card">
        <strong className="summary-number">{total}</strong>
        <span className="summary-label">件物品已经回家</span>
      </div>

      {list.length === 0 ? (
        <div className="empty">还没有已找到记录</div>
      ) : (
        <div className="feed-panel">
          {list.map((item) => (
            <button key={item.id} className="found-row" type="button" onClick={() => onOpen(item.id)}>
              <span className="badge">已回家</span>
              <span className="item-copy">
                <strong className="title">{item.title}</strong>
                <span className="meta">{item.category}{locationText(item) ? ` · ${locationText(item)}` : ''}</span>
                {claimantText(item) && <span className="meta claimed-meta">{claimantText(item)}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MePage({ items, stats, currentUser, onPublish, onOpen, onMarkReturned, onUndoReturned, onLogin, onLogout }) {
  const shownItems = items.slice(0, 8);
  const displayName = currentUser?.nickName || '未登录';
  const accountEmail = currentUser?.email || currentUser?.contact || '';
  const avatarText = displayName.slice(0, 1);

  return (
    <section className="page me-page">
      <div className="profile-hero">
        <div className="hero-topline">
          <span className="hero-label">个人中心</span>
          <span className="hero-state">{currentUser ? '已登录' : '未登录'}</span>
        </div>
        <div className="profile-main">
          <div className="avatar">{avatarText}</div>
          <div className="identity">
            <h1 className="name">{displayName}</h1>
            <p className="subtitle">{currentUser ? accountEmail : '发布或认领时再登录'}</p>
          </div>
        </div>
        <div className="hero-badge">
          <span>ShanghaiTech Lost &amp; Found</span>
          <span>找回、归还、提醒都在这里</span>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard value={stats.total} label="全部发布" />
        <StatCard value={stats.active} label="进行中" />
        <StatCard value={stats.returned} label="已找回" />
      </div>

      <div className="card profile-form">
        <div className="section-head">
          <div>
            <span className="section-kicker">账号操作</span>
            <h2 className="form-title">{currentUser ? '登录管理' : '登录后使用完整功能'}</h2>
          </div>
          <span className="section-note">{currentUser ? '当前账号' : '校内邮箱'}</span>
        </div>
        <p className="account-action-copy">
          {currentUser
            ? '退出后仍可浏览公告，发布、认领和评论时需要重新登录。'
            : '使用上科大邮箱注册或登录后，可以发布、认领、评论并同步到云端。'}
        </p>
        {currentUser ? (
          <button className="button-secondary account-auth-button" type="button" onClick={onLogout}>退出登录</button>
        ) : (
          <button className="button-primary account-auth-button" type="button" onClick={onLogin}>登录/注册</button>
        )}
      </div>

      <div className="section-head list-head">
        <div>
          <span className="section-kicker">发布记录</span>
          <h2 className="form-title">我的发布</h2>
        </div>
      </div>

      {shownItems.length === 0 ? (
        <div className="empty-panel">
          <div className="empty-mark">+</div>
          <strong className="empty-title">还没有发布过线索</strong>
          <span className="empty-copy">发布招领或寻物后，会在这里统一管理状态。</span>
        </div>
      ) : shownItems.map((item) => (
        <div key={item.id} className="card mine-card">
          <button className="item-content" type="button" onClick={() => onOpen(item.id)}>
            <span className="item-row">
              <span className={`type-pill ${item.type}`}>{item.type === 'lost' ? '寻物' : '招领'}</span>
              <span className="status-text">{item.status === 'returned' ? '已回家' : '进行中'}</span>
            </span>
            <strong className="title">{item.title}</strong>
            <span className="meta">{itemMeta(item)}</span>
          </button>
          {item.status === 'active' ? (
            <button className="small-action" type="button" onClick={() => onMarkReturned(item.id)}>已回家</button>
          ) : (
            <button className="small-action secondary" type="button" onClick={() => onUndoReturned(item.id)}>撤回</button>
          )}
        </div>
      ))}
    </section>
  );
}

function PublishPage({ initialType, initialDraft, items, currentUser, onCancel, onSubmit, onOpenMatch }) {
  const defaultLocation = locations[0];
  const [form, setForm] = useState(() => ({
    type: initialDraft?.type || initialType,
    title: initialDraft?.title || '',
    description: initialDraft?.description || '',
    category: initialDraft?.category || '',
    tags: [...(initialDraft?.tags || [])],
    visualDescription: initialDraft?.visualDescription || '',
    rawPredictions: [...(initialDraft?.rawPredictions || [])],
    locationId: initialDraft?.locationId || defaultLocation.id,
    locationDetail: initialDraft?.locationDetail || '',
    locationImages: [...(initialDraft?.locationImages || [])],
    image: initialDraft?.image || '',
    ownerName: currentUser?.nickName || initialDraft?.ownerName || '网页用户'
  }));
  const [classifying, setClassifying] = useState(false);
  const [modelError, setModelError] = useState('');
  const [aiProcessStage, setAiProcessStage] = useState('idle');
  const [aiExtractedText, setAiExtractedText] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [locationImageStatus, setLocationImageStatus] = useState('');
  const [locationImageMessage, setLocationImageMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const classification = classifyByText(`${form.title} ${form.description}`);
    if (!form.image && (!form.category || classification.confidence > 0)) {
      setForm((current) => ({
        ...current,
        category: classification.category,
        tags: classification.tags
      }));
    }
  }, [form.title, form.description]);

  useEffect(() => {
    if (!form.image || form.title) return;
    const nextTitle = suggestedTitle(form);
    if (!nextTitle) return;
    setForm((current) => (current.title ? current : { ...current, title: nextTitle }));
  }, [form.image, form.title, form.category, form.visualDescription, form.tags]);

  const matches = useMemo(() => findPotentialMatches(form, items), [form, items]);
  const selectedLocation = getLocation(form.locationId);
  const locationOptions = useMemo(() => {
    const query = locationQuery.trim().toLowerCase();
    const selected = getLocation(form.locationId);
    const filtered = query
      ? locations.filter((location) => (
        [location.name, location.area, location.category, location.guide, location.searchableText]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      ))
      : locations;

    if (!selected || filtered.some((location) => location.id === selected.id)) return filtered;
    return [selected, ...filtered];
  }, [form.locationId, locationQuery]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function selectLocation(locationId) {
    const location = getLocation(locationId);
    setForm((current) => ({
      ...current,
      locationId,
      locationDetail: current.locationId === locationId
        ? current.locationDetail
        : ''
    }));
  }

  function recognitionHint(nextForm = form) {
    return [nextForm.title, nextForm.description, nextForm.category, ...(nextForm.tags || [])].join(' ').trim();
  }

  function extractedText(data = {}) {
    return [data.category, ...(data.tags || [])]
      .filter((entry) => entry && !['其他', '待确认'].includes(entry))
      .slice(0, 4)
      .join('、') || '物品特征待确认';
  }

  function suggestedTitle(data = {}) {
    if (data.title || data.name) return data.title || data.name;

    const tags = [
      ...(data.colors || []),
      ...(data.tags || []),
      ...(data.semanticTags || []),
      ...(data.yoloObjects || []),
      data.category
    ].filter(Boolean);
    const uniqueTags = Array.from(new Set(tags.map((entry) => String(entry).trim()).filter(Boolean)));
    const title = uniqueTags
      .filter((entry) => !['其他', '待确认'].includes(entry))
      .slice(0, 3)
      .join('');
    return title || data.category || '';
  }

  async function chooseImage(file) {
    if (!file) return;
    setClassifying(true);
    setModelError('');
    setAiProcessStage('recognizing');
    setAiExtractedText('');
    try {
      const result = await recognizeImageFile(file, recognitionHint());
      const data = result.data || {};
      const nextExtractedText = extractedText(data);
      const nextTitle = suggestedTitle(data);
      setForm((current) => ({
        ...current,
        image: result.image,
        title: current.title || nextTitle,
        description: current.description || data.description || data.visualDescription || '',
        category: data.category || current.category || '其他',
        tags: data.tags || [],
        visualDescription: data.visualDescription || data.description || '',
        rawPredictions: data.rawPredictions || []
      }));
      setAiExtractedText(nextExtractedText);
      setAiProcessStage('matching');
      if (result.warning) setModelError(result.warning);
    } catch (error) {
      setModelError(`图片识别失败：${error.message || '请手动填写或重新上传'}`);
      setAiProcessStage('error');
    } finally {
      setClassifying(false);
    }
  }

  async function addLocationImages(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.type?.startsWith('image/'));
    if (!files.length) return;
    setLocationImageStatus('loading');
    setLocationImageMessage('正在根据方位图片生成方位描述');
    try {
      const images = await Promise.all(files.slice(0, 6).map(readLocationImageFile));
      setForm((current) => ({
        ...current,
        locationImages: [...(current.locationImages || []), ...images].slice(0, 6)
      }));
    } catch {
      setLocationImageStatus('error');
      setLocationImageMessage('方位图片读取失败，请重新选择图片');
      return;
    }

    try {
      const result = await recognizeImageFile(files[0], locationImageHint(selectedLocation), { purpose: 'locationDetail' });
      const detail = locationDetailFromRecognition(result.data || {}, selectedLocation);
      if (!detail) throw new Error('没有识别到可用于定位的空间线索');
      const shouldFillDetail = !form.locationDetail.trim();
      setForm((current) => ({
        ...current,
        locationDetail: current.locationDetail.trim() ? current.locationDetail : detail
      }));
      setLocationImageStatus('done');
      setLocationImageMessage(shouldFillDetail ? '已根据方位图片生成方位描述' : '已识别方位图片；保留你已填写的方位描述');
    } catch (error) {
      setLocationImageStatus('error');
      setLocationImageMessage(`方位图片识别失败：${error.message || '可手动填写具体方位'}`);
    }
  }

  function removeLocationImage(index) {
    setForm((current) => ({
      ...current,
      locationImages: (current.locationImages || []).filter((_, imageIndex) => imageIndex !== index)
    }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page publish-page">
      <div className="publish-hero">
        <div className="hero-copy">
          <span className="surface-eyebrow">{form.type === 'lost' ? '寻物登记' : '招领登记'}</span>
          <h1 className="surface-title">{form.type === 'lost' ? '先把线索留下' : '捡到物品，先贴到公告栏'}</h1>
          <p className="surface-subtitle">
            {form.type === 'lost'
              ? '描述物品和最后出现的位置，方便同学帮你留意。'
              : '照片可以后补；地点和分类越具体，越容易找到主人。'}
          </p>
        </div>
        <div className="hero-pin" aria-hidden="true">
          <span className="hero-pin-plus">+</span>
          <span>发布</span>
        </div>
      </div>

      <form className="publish-card" onSubmit={submit}>
        <div className="segmented" aria-label="发布类型">
          <button type="button" className={form.type === 'found' ? 'active' : ''} onClick={() => update('type', 'found')}>我捡到了</button>
          <button type="button" className={form.type === 'lost' ? 'active' : ''} onClick={() => update('type', 'lost')}>我丢了</button>
        </div>

        <label className="image-picker">
          {form.image ? (
            <img src={form.image} alt="" />
          ) : (
            <span className="image-empty">
              <span className="image-plus">+</span>
              <span className="image-title">拍照或从相册选择</span>
              <span className="image-hint">没有照片也可以先发布</span>
            </span>
          )}
          <input type="file" accept="image/*" onChange={(event) => chooseImage(event.target.files?.[0])} />
        </label>

        {(classifying || aiProcessStage !== 'idle' || modelError || form.visualDescription) && (
          <RecognitionPanel
            classifying={classifying}
            stage={aiProcessStage}
            extractedText={aiExtractedText}
            type={form.type}
            error={modelError}
            visualDescription={form.visualDescription}
          />
        )}

        <div className="form-section">
          <span className="section-kicker">物品信息</span>
          <input className="field" placeholder="物品标题，可不填" value={form.title} onChange={(event) => update('title', event.target.value)} />
          <textarea className="field textarea" placeholder="补充描述，可不填" value={form.description} onChange={(event) => update('description', event.target.value)} />
        </div>

        <div className="form-section">
          <div className="section-head publish-section-head">
            <span className="section-kicker">物品分类</span>
            <span className="section-note">可自动识别，也可手动改</span>
          </div>
          {form.category && (
            <div className="ai-result">
              <span>当前分类：{form.category}</span>
              <button type="button" onClick={() => update('category', '')}>清除</button>
            </div>
          )}
          <CategoryBar
            value={form.category}
            onChange={(entry) => update('category', entry)}
            hideAll
            tone="found"
          />
        </div>

        <div className="form-section">
          <div className="section-head publish-section-head">
            <span className="section-kicker">地点</span>
            <span className="section-note">官方地图建筑 {campusMapMeta.buildingCount} 处，地点 {campusMapMeta.serviceCount} 处</span>
          </div>
          <div className="location-panel ok">
            <div className="location-head">
              <div>
                <strong className="location-title">{selectedLocation.name}</strong>
                <span className="location-subtitle">{selectedLocation.area}</span>
              </div>
            </div>
            <input
              className="field location-search-field"
              placeholder="搜索建筑、食堂、服务点"
              value={locationQuery}
              onChange={(event) => setLocationQuery(event.target.value)}
            />
            <select className="field select-field" value={form.locationId} onChange={(event) => selectLocation(event.target.value)}>
              {locationOptions.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
            <CampusLocationMap selectedId={form.locationId} onSelect={selectLocation} />
            <div className="location-confirm">
              <div className="location-confirm-row">
                <span>已选择：</span>
                <strong>{selectedLocation.name}</strong>
              </div>
              <div className="location-confirm-row">
                <span>地点区域：</span>
                <strong>{selectedLocation.area}</strong>
              </div>
            </div>
            <div className="location-detail-wrap">
              <textarea
                className="field textarea location-detail-field"
                aria-label="补充具体方位"
                value={form.locationDetail}
                onChange={(event) => update('locationDetail', event.target.value)}
              />
              {!form.locationDetail.trim() && (
                <span className="location-detail-placeholder">{LOCATION_DETAIL_HINT}</span>
              )}
            </div>
            <div className="location-image-section">
              {(form.locationImages || []).length > 0 && (
                <div className="location-image-grid">
                  {form.locationImages.map((image, index) => (
                    <span className="location-image-thumb" key={`${image}-${index}`}>
                      <img src={image} alt="" />
                      <button type="button" aria-label="删除方位图片" onClick={() => removeLocationImage(index)}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <label className="location-image-add">
                <span className="location-image-add-mark">+</span>
                <span>添加方位图片</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    addLocationImages(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              {locationImageMessage && (
                <p className={`location-image-status ${locationImageStatus}`}>{locationImageMessage}</p>
              )}
            </div>
          </div>
        </div>

        {form.type === 'lost' && matches.length > 0 && (
          <div className="match-panel">
            <h2 className="match-title">可能是这几件</h2>
            {matches.map((item) => (
              <div key={item.id} className="match-item">
                <div>
                  <strong className="match-name">{item.title}</strong>
                  <span className="match-meta">{locationText(item)} · 相似度 {item.similarity}%</span>
                  <span className="match-reason">{item.reasons.join('、')}</span>
                </div>
                <button className="match-pill" type="button" onClick={() => onOpenMatch(item.id, form)}>查看</button>
              </div>
            ))}
          </div>
        )}

        <div className="publish-actions">
          <button className="button-secondary" type="button" onClick={onCancel} disabled={submitting}>取消</button>
          <button className="button-primary submit" type="submit" disabled={submitting}>{submitting ? '发布中' : '发布'}</button>
        </div>
      </form>
    </section>
  );
}

function readLocationImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSize = 960;
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function CampusLocationMap({ selectedId, onSelect }) {
  const mappedLocations = locations.filter((location) => Number.isFinite(location.x) && Number.isFinite(location.y));

  function handleKeyDown(event, locationId) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(locationId);
  }

  function handleMapClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100
    };
    const location = findMapLocation(point, mappedLocations);
    if (location) onSelect(location.id);
  }

  return (
    <div className="campus-map-shell">
      <svg className="campus-map" viewBox={`0 0 ${CAMPUS_MAP_VIEW_WIDTH} ${CAMPUS_MAP_VIEW_HEIGHT}`} role="img" aria-label="上海科技大学校内地点地图" onClick={handleMapClick}>
        <image className="campus-map-image" href={campusMapImage} x="0" y="0" width={CAMPUS_MAP_VIEW_WIDTH} height={CAMPUS_MAP_VIEW_HEIGHT} preserveAspectRatio="xMidYMid meet" />
        {campusMapImageBoundaries.map((boundary) => (
          <polygon
            key={boundary.id}
            className={`campus-map-image-boundary ${boundary.family || ''}`}
            points={pointsAttr(boundary.points)}
          />
        ))}
        {mappedLocations.map((location) => {
          const isSelected = location.id === selectedId;
          const hasShape = location.mapShapes?.length > 0;
          const shapes = hasShape && Array.isArray(location.mapShapes[0])
            ? location.mapShapes
            : hasShape
              ? [location.mapShapes]
              : [];
          return (
            <g
              key={location.id}
              className={`campus-map-location ${location.sourceType || 'building'} ${isSelected ? 'selected' : ''}`}
              data-location-id={location.id}
              role="button"
              tabIndex="0"
              aria-label={location.name}
              onClick={() => onSelect(location.id)}
              onKeyDown={(event) => handleKeyDown(event, location.id)}
            >
              <title>{location.name}</title>
              {hasShape ? (
                shapes.map((shape, index) => (
                  <polygon key={`${location.id}-${index}`} points={pointsAttr(shape)} />
                ))
              ) : (
                <circle className="campus-map-point" cx={mapX(location.x)} cy={mapY(location.y)} r={mapR(isSelected ? 1.75 : 1.05)} />
              )}
              <circle className="campus-map-dot" cx={mapX(location.x)} cy={mapY(location.y)} r={mapR(isSelected ? 1.9 : 0.85)} />
              {isSelected && (
                <text className="campus-map-label" x={mapX(location.x)} y={mapY(Math.max(location.y - 2.8, 4))}>
                  {shortLocationLabel(location.name)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const CAMPUS_MAP_VIEW_WIDTH = campusMapMeta.imageCalibration?.imageWidth || 100;
const CAMPUS_MAP_VIEW_HEIGHT = campusMapMeta.imageCalibration?.imageHeight || 100;

function mapX(value) {
  return (value / 100) * CAMPUS_MAP_VIEW_WIDTH;
}

function mapY(value) {
  return (value / 100) * CAMPUS_MAP_VIEW_HEIGHT;
}

function mapR(value) {
  return (value / 100) * CAMPUS_MAP_VIEW_HEIGHT;
}

function findMapLocation(point, candidates) {
  let contained = null;
  let containedArea = Infinity;
  let nearest = null;
  let nearestDistance = Infinity;

  candidates.forEach((location) => {
    const distance = distanceToLocation(point, location);
    if (distance < nearestDistance) {
      nearest = location;
      nearestDistance = distance;
    }

    const shapes = normalizedMapShapes(location);
    if (!shapes.length) return;
    const containingShapes = shapes.filter((shape) => pointInPolygon(point, shape));
    if (!containingShapes.length) return;
    const area = Math.min(...containingShapes.map(polygonArea));

    if (area < containedArea || (area === containedArea && distance < distanceToLocation(point, contained))) {
      contained = location;
      containedArea = area;
    }
  });

  if (contained) return contained;
  if (nearestDistance <= 2) return nearest;
  return nearestDistance <= 4.2 ? nearest : null;
}

function normalizedMapShapes(location) {
  if (!location.mapShapes?.length) return [];
  return Array.isArray(location.mapShapes[0]) ? location.mapShapes : [location.mapShapes];
}

function distanceToLocation(point, location) {
  return Math.hypot(point.x - location.x, point.y - location.y);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const currentX = Array.isArray(currentPoint) ? currentPoint[0] : currentPoint.x;
    const currentY = Array.isArray(currentPoint) ? currentPoint[1] : currentPoint.y;
    const previousX = Array.isArray(previousPoint) ? previousPoint[0] : previousPoint.x;
    const previousY = Array.isArray(previousPoint) ? previousPoint[1] : previousPoint.y;
    const crosses = (currentY > point.y) !== (previousY > point.y);
    if (!crosses) continue;
    const intersectX = ((previousX - currentX) * (point.y - currentY)) / (previousY - currentY) + currentX;
    if (point.x < intersectX) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon) {
  if (!polygon?.length) return Infinity;
  let area = 0;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const currentX = Array.isArray(currentPoint) ? currentPoint[0] : currentPoint.x;
    const currentY = Array.isArray(currentPoint) ? currentPoint[1] : currentPoint.y;
    const previousX = Array.isArray(previousPoint) ? previousPoint[0] : previousPoint.x;
    const previousY = Array.isArray(previousPoint) ? previousPoint[1] : previousPoint.y;
    area += (previousX * currentY) - (currentX * previousY);
  }
  return Math.abs(area) / 2;
}

function pointsAttr(points) {
  return points
    .map((point) => {
      const x = Array.isArray(point) ? point[0] : point.x;
      const y = Array.isArray(point) ? point[1] : point.y;
      return `${mapX(x)},${mapY(y)}`;
    })
    .join(' ');
}

function shortLocationLabel(name) {
  const chars = Array.from(name || '');
  return chars.length > 8 ? `${chars.slice(0, 8).join('')}…` : chars.join('');
}

function PwaInstallButton({ tone, onClick }) {
  return (
    <button className={`desktop-install ${tone}`} type="button" onClick={onClick} aria-label="添加到手机桌面">
      <span className="desktop-install-icon">⌂</span>
      <span>桌面端</span>
    </button>
  );
}

function PwaInstallGuide({ onClose }) {
  const lines = pwaGuideLines();
  return (
    <div className="pwa-backdrop" role="dialog" aria-modal="true" aria-label="添加到桌面">
      <div className="pwa-panel">
        <div className="pwa-head">
          <div>
            <span className="pwa-kicker">桌面端</span>
            <h2>添加到手机桌面</h2>
            <p>添加后可以像 App 一样从桌面打开，访问更快，也更适合日常使用。</p>
          </div>
          <button className="pwa-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <ol className="pwa-steps">
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ol>
        <button className="button-primary pwa-confirm" type="button" onClick={onClose}>我知道了</button>
      </div>
    </div>
  );
}

function RecognitionPanel({ classifying, stage, extractedText, type, error, visualDescription }) {
  const target = type === 'lost' ? '历史招领' : '历史寻物';
  const steps = stage === 'error'
    ? [{ key: 'error', text: '图片识别失败，可手动填写或重新上传', status: 'error' }]
    : [
      {
        key: 'recognize',
        text: '正在识别物品特征',
        status: stage === 'recognizing' ? 'active' : 'done'
      },
      {
        key: 'extract',
        text: extractedText ? `已提取：${extractedText}` : '等待提取颜色、类别和细节',
        status: extractedText ? 'done' : 'pending'
      },
      {
        key: 'match',
        text: `正在匹配${target}`,
        status: stage === 'matching' ? 'active' : 'pending'
      }
    ];

  return (
    <div className="recognition-panel">
      <div className="ai-process-head">
        <span>识别建议</span>
        <span>{classifying ? '处理中' : stage === 'error' ? '需手动确认' : '已更新'}</span>
      </div>
      {steps.map((step) => (
        <div key={step.key} className={`ai-process-step ${step.status}`}>
          <span className="ai-step-dot" />
          <span className="ai-step-text">{step.text}</span>
        </div>
      ))}
      {visualDescription && <p className="model-desc">{visualDescription}</p>}
      {error && <p className={stage === 'error' ? 'model-error' : 'model-warning'}>{error}</p>}
    </div>
  );
}

function AuthModal({ actionLabel, onClose, onSubmit, onSendCode }) {
  const [mode, setMode] = useState('register');
  const [method, setMethod] = useState('password');
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    nickName: '',
    email: '',
    password: '',
    code: ''
  });
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (codeCooldown <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setCodeCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  function update(field, value) {
    const nextValue = field === 'email' ? normalizeEmailPrefix(value) : value;
    setForm((current) => ({ ...current, [field]: nextValue }));
    setError('');
    setStatus('');
  }

  function normalizeEmailPrefix(value = '') {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const prefix = raw.includes('@') ? raw.split('@')[0] : raw;
    return prefix.replace(/[^a-z0-9._-]/g, '');
  }

  function normalizeEmail() {
    const prefix = normalizeEmailPrefix(form.email);
    return prefix ? `${prefix}@${SCHOOL_EMAIL_DOMAIN}` : '';
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setMethod('password');
    setShowPassword(false);
    setError('');
    setStatus('');
  }

  function switchMethod(nextMethod) {
    setMethod(nextMethod);
    setError('');
    setStatus('');
  }

  async function sendCode() {
    if (codeCooldown > 0) return;
    const email = normalizeEmail();
    if (!email) {
      setError('请填写上科大邮箱前缀');
      return;
    }
    setSendingCode(true);
    setError('');
    setStatus('');
    try {
      await onSendCode(email, mode === 'register' ? 'register' : 'login');
      setForm((current) => ({ ...current, email: email.split('@')[0] }));
      setCodeCooldown(EMAIL_CODE_COOLDOWN_SECONDS);
      setStatus('验证码已发送，请查收上科大邮箱');
    } catch (sendError) {
      setError(sendError?.message || '验证码发送失败');
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const email = normalizeEmail();
    const nickName = form.nickName.trim();
    if (!email) {
      setError('请填写上科大邮箱前缀');
      return;
    }
    if (mode === 'register' && !nickName) {
      setError('请填写昵称');
      return;
    }
    if ((mode === 'register' || method === 'password') && form.password.trim().length < 6) {
      setError('密码至少需要 6 位');
      return;
    }
    if ((mode === 'register' || method === 'code') && !/^\d{6}$/.test(form.code.trim())) {
      setError('请填写 6 位邮箱验证码');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        mode,
        method,
        nickName: nickName || email.split('@')[0] || '网页用户',
        email,
        password: form.password.trim(),
        code: form.code.trim()
      });
    } catch (submitError) {
      setError(submitError?.message || '登录失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const needsCode = mode === 'register' || method === 'code';
  const codeButtonText = sendingCode
    ? '发送中'
    : codeCooldown > 0
      ? `${codeCooldown}s 后重发`
      : '获取验证码';

  return (
    <div className="auth-backdrop" role="dialog" aria-modal="true" aria-label="登录或注册">
      <form className="auth-panel" onSubmit={submit}>
        <div className="auth-head">
          <div>
            <span className="auth-kicker">{actionLabel}</span>
            <h2>{mode === 'register' ? '注册上科大账号' : '登录后继续'}</h2>
            <p>仅支持上科大邮箱，发布、认领和提交线索会同步到云端。</p>
          </div>
          <button className="auth-close" type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>

        <div className="auth-switch" aria-label="登录注册切换">
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>注册</button>
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>登录</button>
        </div>

        {mode === 'login' && (
          <div className="auth-method" aria-label="登录方式">
            <button type="button" className={method === 'password' ? 'active' : ''} onClick={() => switchMethod('password')}>密码登录</button>
            <button type="button" className={method === 'code' ? 'active' : ''} onClick={() => switchMethod('code')}>验证码登录</button>
          </div>
        )}

        {mode === 'login' && method === 'code' && (
          <p className="auth-inline-note">已注册账号可以直接用邮箱验证码登录；还没有账号请先切换到“注册”。</p>
        )}

        {mode === 'register' && (
          <p className="auth-inline-note">注册需要邮箱验证码，并设置以后登录使用的密码。</p>
        )}

        {mode === 'register' && (
          <label className="auth-field">
            <span>昵称</span>
            <input value={form.nickName} placeholder="例如：图书馆同学" onChange={(event) => update('nickName', event.target.value)} />
          </label>
        )}

        <label className="auth-field">
          <span>上科大邮箱</span>
          <div className="auth-email-row">
            <input value={form.email} placeholder="name" autoCapitalize="none" autoComplete="username" onChange={(event) => update('email', event.target.value)} />
            <span className="auth-email-suffix">@{SCHOOL_EMAIL_DOMAIN}</span>
          </div>
        </label>

        {(mode === 'register' || method === 'password') && (
          <label className="auth-field">
            <span>密码</span>
            <div className="auth-password-row">
              <input type={showPassword ? 'text' : 'password'} value={form.password} placeholder="至少 6 位" onChange={(event) => update('password', event.target.value)} />
              <button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? '隐藏' : '显示'}</button>
            </div>
          </label>
        )}

        {needsCode && (
          <label className="auth-field">
            <span>邮箱验证码</span>
            <div className="auth-code-row">
              <input value={form.code} inputMode="numeric" maxLength={6} placeholder="6 位验证码" onChange={(event) => update('code', event.target.value.replace(/\D/g, '').slice(0, 6))} />
              <button type="button" onClick={sendCode} disabled={sendingCode || codeCooldown > 0}>{codeButtonText}</button>
            </div>
          </label>
        )}

        {status && <div className="auth-status">{status}</div>}
        {error && <div className="auth-error">{error}</div>}

        <button className="button-primary auth-submit" type="submit" disabled={submitting}>
          {submitting ? '处理中...' : mode === 'register' ? '注册并继续' : '登录并继续'}
        </button>
        <p className="auth-note">验证码通过云函数发送；密码只保存加盐哈希，不会存明文。</p>
      </form>
    </div>
  );
}

function DetailPage({ item, items, comments = [], onBack, claiming = false, onClaim, onComment, onOpenMatch }) {
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const matches = findPotentialMatches(item, items);
  const location = itemLocation(item) || {
    name: '未选择地点',
    area: '',
    guide: item.locationDetail || '',
    mapDescription: item.locationDetail || ''
  };

  async function submitComment(event) {
    event.preventDefault();
    const content = commentText.trim();
    if (!content || submittingComment) return;
    setSubmittingComment(true);
    const submitted = await onComment(content);
    if (submitted) setCommentText('');
    setSubmittingComment(false);
  }

  return (
    <section className="page detail-page">
      <button className="back-button" type="button" onClick={onBack}>返回</button>

      <div className="detail-image">
        {item.image ? <img src={item.image} alt="" /> : <span>{item.category}</span>}
      </div>

      <div className="card detail-card">
        <div className="detail-head">
          <div className="title-block">
            <span className="detail-kicker">{item.type === 'lost' ? '寻物详情' : '招领详情'}</span>
            <h1 className="title">{item.title}</h1>
          </div>
          <span className={`type-pill ${item.status === 'returned' ? 'returned' : item.type}`}>
            {item.status === 'returned' ? '已回家' : (item.type === 'lost' ? '寻物中' : '招领中')}
          </span>
        </div>
        <p className="desc">{item.description}</p>
        <div className="tag-row">
          <span className="tag active">{item.category}</span>
          {(item.tags || []).filter((tag) => tag !== item.category).map((tag) => <span key={tag} className="tag">{tag}</span>)}
        </div>
        {claimantText(item) && (
          <div className="claimant-note">
            <span>领取人</span>
            <strong>{claimantText(item)}</strong>
          </div>
        )}
      </div>

      <div className="card location-card">
        <div className="location-heading">
          <div>
            <strong className="location-name">{location.name}</strong>
            <span className="muted">{location.area}</span>
          </div>
          <span className="location-badge">校内定位</span>
        </div>
        <div className="location-guide">{location.guide}</div>
        {(item.locationImages || []).length > 0 && (
          <div className="location-photo-strip">
            {item.locationImages.map((image, index) => (
              <img key={`${image}-${index}`} src={image} alt="" />
            ))}
          </div>
        )}
        <p className="map-note">地图为辅助定位，具体位置以发布人选择的地点标记为准。</p>
      </div>

      {item.type === 'found' && item.status === 'active' && (
        <div className="detail-action-row">
          <button className="button-primary detail-claim-button" type="button" onClick={onClaim} disabled={claiming}>
            {claiming ? '认领中' : '我要认领'}
          </button>
        </div>
      )}

      {matches.length > 0 && (
        <>
          <h2 className="section-title">可能匹配</h2>
          <div className="feed-panel">
            {matches.map((match) => (
              <button
                key={match.id}
                className="found-row compact match-link"
                type="button"
                onClick={() => onOpenMatch(match.id)}
              >
                <span className="badge">{match.similarity}%</span>
                <span className="item-copy">
                  <strong className="title">{match.title}</strong>
                  <span className="meta">{match.reasons.join('、')}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">评论</h2>
      {comments.length === 0 ? (
        <div className="empty small">还没有评论</div>
      ) : (
        <div className="comment-list">
          {comments.map((comment) => (
            <div className="comment-card" key={comment.id}>
              <div className="comment-head">
                <strong>{comment.authorName}</strong>
                <span>{formatDate(comment.createdAt)}</span>
              </div>
              <p>{comment.content}</p>
            </div>
          ))}
        </div>
      )}
      <form className="comment-box" onSubmit={submitComment}>
        <input
          value={commentText}
          placeholder="写下线索或领取信息"
          onChange={(event) => setCommentText(event.target.value)}
        />
        <button type="submit" disabled={submittingComment}>{submittingComment ? '发送中' : '发送'}</button>
      </form>
    </section>
  );
}

function CategoryBar({ value, onChange, hideAll = false, tone = 'found' }) {
  const list = hideAll ? categories.filter((entry) => entry !== '全部') : categories;
  return (
    <div className={`category-bar ${tone}`}>
      {list.map((entry) => (
        <button
          key={entry}
          className={`tag ${value === entry ? 'active' : ''}`}
          type="button"
          onClick={() => onChange(entry)}
        >
          {entry}
        </button>
      ))}
    </div>
  );
}

function SemanticSearchBox({ value, onChange, tone = 'found', resultCount, totalCount, placeholder }) {
  const active = value.trim().length > 0;
  return (
    <div className={`semantic-search ${tone}`}>
      <div className="semantic-search-row">
        <span className="semantic-search-icon" aria-hidden="true">⌕</span>
        <input
          value={value}
          placeholder={placeholder}
          aria-label="语义搜索"
          onChange={(event) => onChange(event.target.value)}
        />
        {active && (
          <button type="button" aria-label="清空语义搜索" onClick={() => onChange('')}>×</button>
        )}
      </div>
      <div className="semantic-search-meta">
        <span>匹配标题、描述、AI 标签、地点和方位信息</span>
        {active && <strong>命中 {resultCount}/{totalCount} 条</strong>}
      </div>
    </div>
  );
}

function FeedPanel({ items, kind, onOpen }) {
  return (
    <div className={`feed-panel ${kind}`}>
      {items.map((item) => (
        <button key={item.id} className="item-row" type="button" onClick={() => onOpen(item.id)}>
          <span className={`image-box ${kind}`}>
            {item.image ? <img src={item.image} alt="" /> : <span>{item.category}</span>}
          </span>
          <span className="item-main">
            <span className="item-head">
              <strong className="item-title">{item.title}</strong>
              <span className={`type-pill ${kind === 'lost' ? 'lost' : 'found'}`}>{kind === 'lost' ? '寻物中' : '招领中'}</span>
            </span>
            <span className="item-desc">{item.description}</span>
            <span className="item-meta">
              <span className={`pin-dot ${kind === 'lost' ? 'lost' : ''}`} />
              <span>{locationText(item)}</span>
              <span className="tag light">{item.category}</span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function TabBar({ view, onChange, onPublish }) {
  const firstItems = tabItems.slice(0, 2);
  const lastItems = tabItems.slice(2);
  const renderTab = (item) => {
    const active = view === item.key;
    return (
      <button key={item.key} type="button" className={active ? 'active' : ''} onClick={() => onChange(item.key)}>
        <img src={active ? item.activeIcon : item.icon} alt="" />
        <span>{item.text}</span>
      </button>
    );
  };

  return (
    <nav className="tab-bar" aria-label="主导航">
      {firstItems.map(renderTab)}
      <button className="tab-publish-button" type="button" aria-label="发布" onClick={onPublish}>
        <span className="tab-publish-plus">+</span>
        <span className="tab-publish-label">发布</span>
      </button>
      {lastItems.map(renderTab)}
    </nav>
  );
}

function StatCard({ value, label }) {
  return (
    <div className="stat-card">
      <strong className="stat-value">{value}</strong>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function filterItems(items, type, status, category) {
  return items
    .filter((item) => item.type === type && item.status === status)
    .filter((item) => category === '全部' || item.category === category)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function locationText(item) {
  return itemLocation(item)?.name || '';
}

function itemLocation(item = {}) {
  const known = knownLocationById(item.locationId);
  if (known) return known;

  const name = String(item.locationName || '').trim();
  if (!name) return null;

  const guide = item.locationGuide || item.locationDetail || '';
  return {
    id: item.locationId || '',
    name,
    area: item.locationArea || '',
    guide,
    mapDescription: guide
  };
}

function knownLocationById(locationId) {
  const id = String(locationId || '').trim();
  if (!id) return null;
  const resolvedId = locationAliases[id] || id;
  return locations.find((location) => location.id === resolvedId) || null;
}

function itemMeta(item) {
  const date = formatDate(item.createdAt);
  const location = locationText(item);
  const claimant = item.status === 'returned' ? claimantText(item) : '';
  return [item.category, location, claimant, date].filter(Boolean).join(' · ');
}

function claimantText(item) {
  const name = String(item.claimantName || '').trim();
  const contact = String(item.claimantContact || '').trim();
  if (!name && !contact) return '';
  return `领取人：${[name, contact].filter(Boolean).join(' · ')}`;
}

export default App;
