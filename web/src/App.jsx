import { useEffect, useMemo, useState } from 'react';
import { categories, locations } from './data.js';
import { createItem, loadItems, saveItems } from './store.js';
import { classifyByText, findPotentialMatches, formatDate, getLocation } from './utils.js';
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

function App() {
  const [items, setItems] = useState(() => loadItems());
  const [view, setView] = useState('found');
  const [activeCategory, setActiveCategory] = useState('全部');
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    saveItems(items);
  }, [items]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

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

  function openDetail(id) {
    setSelectedId(id);
    setView('detail');
  }

  function openTab(key) {
    setActiveCategory('全部');
    setView(key);
  }

  function openPublish(type = 'found') {
    setView(type === 'lost' ? 'publish-lost' : 'publish-found');
  }

  function publishItem(payload) {
    const nextItem = createItem({
      ...payload,
      title: payload.title || (payload.type === 'lost' ? '未命名寻物' : '未命名招领'),
      description: payload.description || '暂无补充描述'
    });
    setItems((current) => [nextItem, ...current]);
    setSelectedId(nextItem.id);
    setView('detail');
    setToast(payload.type === 'lost' ? '已发布寻物' : '已发布招领');
  }

  function markReturned(id) {
    setItems((current) => current.map((item) => (
      item.id === id
        ? { ...item, status: 'returned', returnedAt: new Date().toISOString() }
        : item
    )));
    setToast('已回家');
  }

  function undoReturned(id) {
    setItems((current) => current.map((item) => (
      item.id === id
        ? { ...item, status: 'active', returnedAt: null }
        : item
    )));
    setToast('已撤回');
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
          onPublish={() => openPublish('found')}
          onOpen={openDetail}
          onMarkReturned={markReturned}
          onUndoReturned={undoReturned}
        />
      )}

      {view.startsWith('publish') && (
        <PublishPage
          initialType={view === 'publish-lost' ? 'lost' : 'found'}
          items={items}
          onCancel={() => openTab(view === 'publish-lost' ? 'lost' : 'found')}
          onSubmit={publishItem}
        />
      )}

      {view === 'detail' && selectedItem && (
        <DetailPage
          item={selectedItem}
          items={items}
          onBack={() => openTab(selectedItem.status === 'returned' ? 'returned' : selectedItem.type)}
          onMarkReturned={() => markReturned(selectedItem.id)}
          onUndoReturned={() => undoReturned(selectedItem.id)}
        />
      )}

      {showTabBar && <TabBar view={view} onChange={openTab} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function FoundPage({ items, activeCategory, setActiveCategory, total, onPublish, onOpen }) {
  const list = filterItems(items, 'found', 'active', activeCategory);
  return (
    <section className="page found-page">
      <div className="board-head">
        <div>
          <h1 className="app-title">校园公告板</h1>
          <p className="app-subtitle">上海科技大学 · 失物招领平台</p>
        </div>
      </div>

      <button className="notice-banner" type="button" onClick={onPublish}>
        <div className="notice-copy">
          <strong className="notice-title">拾金不昧，传递温暖</strong>
          <span className="notice-subtitle">如遇失物，请及时发布招领信息</span>
        </div>
        <img className="notice-image" src={campusBoardImage} alt="" />
      </button>

      <CategoryBar value={activeCategory} onChange={setActiveCategory} tone="found" />

      {list.length > 0 && (
        <div className="section-bar">
          <div>
            <h2 className="list-title">近期拾到 · {total} 条</h2>
            <p className="list-subtitle">按最新发布排序</p>
          </div>
          <button className="sort-button" type="button" onClick={onPublish}>发布</button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">暂时没有招领信息</div>
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

function LostPage({ items, activeCategory, setActiveCategory, total, onPublish, onOpen }) {
  const list = filterItems(items, 'lost', 'active', activeCategory);
  return (
    <section className="page lost-page">
      <div className="board-head">
        <div>
          <h1 className="app-title">寻物登记</h1>
          <p className="app-subtitle">丢失物品后，先登记线索再等待匹配提醒</p>
        </div>
      </div>

      <button className="notice-banner lost" type="button" onClick={onPublish}>
        <img className="notice-image" src={campusBoardImage} alt="" />
        <div className="notice-copy">
          <strong className="notice-title">丢了东西，先留下线索</strong>
          <span className="notice-subtitle">{total} 条寻物正在等待匹配</span>
        </div>
      </button>

      <CategoryBar value={activeCategory} onChange={setActiveCategory} tone="lost" />

      {list.length > 0 && (
        <div className="section-bar">
          <div>
            <h2 className="list-title">正在寻找 · {total} 条</h2>
            <p className="list-subtitle">同学发布的寻物线索</p>
          </div>
          <button className="sort-button lost" type="button" onClick={onPublish}>发布</button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">暂时没有寻物信息</div>
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
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function MePage({ items, stats, onPublish, onOpen, onMarkReturned, onUndoReturned }) {
  const [profile, setProfile] = useState({ nickName: '微信用户', emailPrefix: '' });
  const shownItems = items.slice(0, 8);
  const avatarText = (profile.nickName || '微').slice(0, 1);

  return (
    <section className="page me-page">
      <div className="profile-hero">
        <div className="hero-topline">
          <span className="hero-label">个人中心</span>
          <span className="hero-state">校内互助账号</span>
        </div>
        <div className="profile-main">
          <div className="avatar">{avatarText}</div>
          <div className="identity">
            <h1 className="name">{profile.nickName || '微信用户'}</h1>
            <p className="subtitle">用于校内失物招领提醒</p>
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
            <span className="section-kicker">账号资料</span>
            <h2 className="form-title">注册资料</h2>
          </div>
          <span className="section-note">用于找回提醒</span>
        </div>
        <input
          className="profile-input"
          placeholder="昵称"
          value={profile.nickName}
          onChange={(event) => setProfile((current) => ({ ...current, nickName: event.target.value }))}
        />
        <div className="email-edit">
          <input
            className="email-prefix"
            placeholder="邮箱前缀"
            type="text"
            value={profile.emailPrefix}
            onChange={(event) => setProfile((current) => ({ ...current, emailPrefix: event.target.value }))}
          />
          <span className="email-domain">@shanghaitech.edu.cn</span>
        </div>
        <button className="button-primary save-profile" type="button">保存资料</button>
      </div>

      <div className="quick-actions">
        <button className="quick-card secondary" type="button">
          <strong className="quick-title">消息中心</strong>
          <span className="quick-subtitle">查看评论与提醒</span>
        </button>
        <button className="quick-card primary" type="button" onClick={onPublish}>
          <strong className="quick-title">继续发布</strong>
          <span className="quick-subtitle">上传线索或寻物</span>
        </button>
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

function PublishPage({ initialType, items, onCancel, onSubmit }) {
  const [form, setForm] = useState({
    type: initialType,
    title: '',
    description: '',
    category: '',
    tags: [],
    locationId: locations[0].id,
    image: '',
    ownerName: '网页用户'
  });

  useEffect(() => {
    const classification = classifyByText(`${form.title} ${form.description}`);
    if (!form.category || classification.confidence > 0) {
      setForm((current) => ({
        ...current,
        category: classification.category,
        tags: classification.tags
      }));
    }
  }, [form.title, form.description]);

  const matches = useMemo(() => findPotentialMatches(form, items), [form, items]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function chooseImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update('image', reader.result);
    reader.readAsDataURL(file);
  }

  function submit(event) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <section className="page publish-page">
      <div className="surface-hero publish-hero">
        <span className="surface-eyebrow">发布线索</span>
        <h1 className="surface-title">{form.type === 'lost' ? '发布寻物' : '发布招领'}</h1>
        <p className="surface-subtitle">上传图片、确认地点，系统会提取标签并提示潜在匹配。</p>
      </div>

      <form className="card publish-card" onSubmit={submit}>
        <div className="segmented" aria-label="发布类型">
          <button type="button" className={form.type === 'found' ? 'active' : ''} onClick={() => update('type', 'found')}>我捡到了</button>
          <button type="button" className={form.type === 'lost' ? 'active' : ''} onClick={() => update('type', 'lost')}>我丢了</button>
        </div>

        <label className="image-picker">
          {form.image ? <img src={form.image} alt="" /> : <span>上传图片，可留空</span>}
          <input type="file" accept="image/*" onChange={(event) => chooseImage(event.target.files?.[0])} />
        </label>

        <input className="field" placeholder="物品标题，可不填" value={form.title} onChange={(event) => update('title', event.target.value)} />
        <textarea className="field textarea" placeholder="补充描述，可不填" value={form.description} onChange={(event) => update('description', event.target.value)} />

        <div className="row-label">分类，可自动识别或手动选择</div>
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

        <div className="location-panel ok">
          <div className="location-head">
            <div className="row-label">地点</div>
          </div>
          <select className="field select-field" value={form.locationId} onChange={(event) => update('locationId', event.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
          <div className="location-confirm">
            <div className="location-confirm-row">
              <span>已选择：</span>
              <strong>{getLocation(form.locationId).name}</strong>
            </div>
            <div className="location-confirm-row">
              <span>地点区域：</span>
              <strong>{getLocation(form.locationId).area}</strong>
            </div>
            <p className="location-confirm-note">{getLocation(form.locationId).guide}</p>
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
                <span className="match-pill">查看</span>
              </div>
            ))}
          </div>
        )}

        <div className="publish-actions">
          <button className="button-secondary" type="button" onClick={onCancel}>取消</button>
          <button className="button-primary submit" type="submit">发布</button>
        </div>
      </form>
    </section>
  );
}

function DetailPage({ item, items, onBack, onMarkReturned, onUndoReturned }) {
  const matches = findPotentialMatches(item, items);
  const location = getLocation(item.locationId);

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
          <span className={`type-pill ${item.type}`}>{item.type === 'lost' ? '寻物中' : '招领中'}</span>
        </div>
        <p className="desc">{item.description}</p>
        <div className="tag-row">
          <span className="tag active">{item.category}</span>
          {(item.tags || []).filter((tag) => tag !== item.category).map((tag) => <span key={tag} className="tag">{tag}</span>)}
        </div>
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
        <p className="map-note">地图为辅助定位，具体位置以发布人选择的地点标记为准。</p>
      </div>

      <div className="action-grid">
        <button className="button-secondary" type="button">感谢发布人</button>
        {item.status === 'active'
          ? <button className="button-primary" type="button" onClick={onMarkReturned}>已回家</button>
          : <button className="button-secondary" type="button" onClick={onUndoReturned}>撤回已回家</button>}
        <button className="button-danger" type="button">举报</button>
      </div>

      {matches.length > 0 && (
        <>
          <h2 className="section-title">可能匹配</h2>
          <div className="feed-panel">
            {matches.map((match) => (
              <div key={match.id} className="found-row compact">
                <span className="badge">{match.similarity}%</span>
                <span className="item-copy">
                  <strong className="title">{match.title}</strong>
                  <span className="meta">{match.reasons.join('、')}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">评论</h2>
      <div className="empty small">还没有评论</div>
      <div className="comment-box">
        <input placeholder="写下线索或领取信息" />
        <button type="button">发送</button>
      </div>
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

function TabBar({ view, onChange }) {
  return (
    <nav className="tab-bar" aria-label="主导航">
      {tabItems.map((item) => {
        const active = view === item.key;
        return (
          <button key={item.key} type="button" className={active ? 'active' : ''} onClick={() => onChange(item.key)}>
            <img src={active ? item.activeIcon : item.icon} alt="" />
            <span>{item.text}</span>
          </button>
        );
      })}
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
  return getLocation(item.locationId)?.name || '';
}

function itemMeta(item) {
  const date = formatDate(item.createdAt);
  const location = locationText(item);
  return [item.category, location, date].filter(Boolean).join(' · ');
}

export default App;
