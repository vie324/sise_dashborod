import { Banner, Button } from '../../ui/primitives.jsx';
import { useMe } from './data.js';
import { SubNav, LoadingState, ErrorState } from './parts.jsx';
import MyHome from './MyHome.jsx';
import ChartView from './ChartView.jsx';
import Editor from './Editor.jsx';
import Review from './Review.jsx';
import Daily from './Daily.jsx';
import Team, { Charts } from './Team.jsx';
import { Peers, Activity } from './Social.jsx';
import Member from './Member.jsx';
import Settings from './Settings.jsx';

// ============================================================
// マンダラ（チャート・週報・日報）
// ------------------------------------------------------------
// 旧「マンダラチャート週次進捗管理ツール」をダッシュボードに組み込んだもの。
// ログインはスタッフ URL のまま。見える範囲は店舗（店長は担当店舗、オーナーは全員）。
//   #/mandala                        ホーム（本人）。管理者モードはチームの状況
//   #/mandala/chart(/:staffId)       チャート（自分 / 仲間）
//   #/mandala/edit/:step/:theme      チャートの作成・編集（5ステップ）
//   #/mandala/review(/:week)         週報
//   #/mandala/daily(/:date)          日報（対象のメンバーだけ）
//   #/mandala/peers                  仲間のマンダラ（共有がオンの時）
//   #/mandala/team(/:week)           チームの状況（店長・オーナー）
//   #/mandala/charts                 みんなのマンダラ
//   #/mandala/activity               日々の動き
//   #/mandala/member/:id/:tab/:arg   メンバーの詳細（週報 / マンダラ / 日報 / 動き）
//   #/mandala/settings               設定（共有・日報の対象・チェック項目）
// ============================================================

const MANAGE_SECTIONS = new Set(['team', 'charts', 'activity', 'member', 'settings']);

function menuFor(me) {
  const items = [];
  if (me.viewer.canHaveChart) {
    items.push(
      { key: 'home', path: '/mandala', label: 'ホーム', icon: 'house' },
      { key: 'chart', path: '/mandala/chart', label: 'チャート', icon: 'grid-3x3' },
      { key: 'review', path: '/mandala/review', label: '週報', icon: 'notebook-pen' },
    );
    if (me.self && me.self.dailyEnabled) items.push({ key: 'daily', path: '/mandala/daily', label: '日報', icon: 'sun-medium' });
    if (me.boardAvailable) items.push({ key: 'peers', path: '/mandala/peers', label: '仲間', icon: 'users-round' });
  }
  if (me.viewer.canManage) {
    items.push(
      { key: 'team', path: '/mandala/team', label: 'チーム', icon: 'users' },
      { key: 'charts', path: '/mandala/charts', label: 'みんなのチャート', icon: 'layout-grid' },
      { key: 'activity', path: '/mandala/activity', label: '動き', icon: 'activity' },
      { key: 'settings', path: '/mandala/settings', label: '設定', icon: 'settings-2' },
    );
  }
  return items;
}

function activeKey(section, me) {
  if (!section) return me.viewer.canHaveChart ? 'home' : 'team';
  if (section === 'edit') return 'chart';
  if (section === 'member') return 'team';
  return section;
}

export default function MandalaPage({ path = '/mandala' }) {
  const meRes = useMe();
  const me = meRes.shown;
  if (!me && meRes.error) return <ErrorState error={meRes.error} onRetry={meRes.reload} />;
  if (!me) return <LoadingState />;

  const [, section = '', a, b, c] = path.split('/').filter(Boolean);
  const items = menuFor(me);
  const canManage = me.viewer.canManage;
  let page;
  if (MANAGE_SECTIONS.has(section) && !canManage) {
    page = <Banner tone="warn">この画面は店長・オーナーだけが見られます。</Banner>;
  } else if (!section) {
    page = me.viewer.canHaveChart ? <MyHome me={me} /> : <Team />;
  } else if (section === 'chart') {
    page = <ChartView key={a || 'me'} staffId={a} />;
  } else if (section === 'edit') {
    page = <Editor step={a} theme={b} me={me} />;
  } else if (section === 'review') {
    page = me.viewer.canHaveChart ? <Review week={a} /> : <Banner tone="info">週報はスタッフ URL で開いて書きます。メンバーの週報は「チーム」から見られます。</Banner>;
  } else if (section === 'daily') {
    page = me.viewer.canHaveChart ? <Daily date={a} /> : <Banner tone="info">日報はスタッフ URL で開いて書きます。</Banner>;
  } else if (section === 'peers') {
    page = <Peers />;
  } else if (section === 'team') {
    page = <Team week={a} />;
  } else if (section === 'charts') {
    page = <Charts />;
  } else if (section === 'activity') {
    page = <Activity />;
  } else if (section === 'member' && a) {
    page = <Member key={a} id={a} tab={b || 'review'} arg={c} me={me} />;
  } else if (section === 'settings') {
    page = <Settings />;
  } else {
    page = <Banner tone="warn" action={<Button size="sm" onClick={() => { window.location.hash = '/mandala'; }}>マンダラのホームへ</Button>}>ページが見つかりません。</Banner>;
  }

  return (
    <div>
      {items.length > 1 ? <SubNav items={items} active={activeKey(section, me)} /> : null}
      <div key={`${section}/${a || ''}/${b || ''}`} className="animate-page-in">{page}</div>
    </div>
  );
}
