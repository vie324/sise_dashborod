import { supabase } from './supabase.js';
import { canAccessStore } from './auth.js';

// ============================================================
// LINEメッセージ
// ============================================================
//
// セキュリティ: LINE関連データは必ず store (store_id) を指定して取得する。
// store が未指定の場合は空配列を返し、店舗横断でのデータ漏えいを防ぐ。
// ============================================================

export async function lineMessagesGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) {
    // 店舗未指定は空レスポンス。店舗スコープを厳格に守るため。
    return params.userId ? { messages: [] } : { threads: [] };
  }
  // スタッフモード: 権限外店舗の LINE メッセージは返さない
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗のLINEデータにアクセスする権限がありません' };
  }

  if (params.userId) {
    // 個別ユーザーのタイムライン (直近N件を古い順で返す)
    const limit = parseInt(params.limit) || 200;
    const { data, error } = await supabase.from('line_messages').select('*')
      .eq('store_id', storeId).eq('user_id', params.userId)
      .order('timestamp', { ascending: false })
      .limit(limit);
    if (error) throw error;
    const messages = (data || []).map(mapMsg).reverse();
    return { messages };
  }

  // スレッド一覧 (当該店舗の最新メッセージ)
  const { data, error } = await supabase.from('line_messages').select('*')
    .eq('store_id', storeId)
    .order('timestamp', { ascending: false })
    .limit(1000);
  if (error) throw error;

  // ユーザーごとに最新メッセージ・未読数を集約
  const threadMap = {};
  for (const msg of data || []) {
    const key = msg.user_id;
    if (!threadMap[key]) {
      threadMap[key] = {
        storeId: msg.store_id,
        userId: msg.user_id,
        lastMessage: mapMsg(msg),
        unread: 0,
        lastReceivedAt: null,
      };
    }
    if (msg.direction === 'received' && msg.message_type !== 'follow' && msg.message_type !== 'unfollow') {
      threadMap[key].unread++;
      if (!threadMap[key].lastReceivedAt) threadMap[key].lastReceivedAt = msg.timestamp;
    }
  }

  // 最新メッセージ順にソート
  const threads = Object.values(threadMap).sort((a, b) => {
    const ta = a.lastMessage?.timestamp || 0;
    const tb = b.lastMessage?.timestamp || 0;
    return new Date(tb) - new Date(ta);
  });

  return { threads };
}

export async function lineMessagesPost(body, staffCtx) {
  // 移行用: direction を保持した一括保存（管理者のみ）
  if (body.action === 'saveAll') {
    if (staffCtx !== null) {
      return { error: '一括保存は管理者のみ許可されています' };
    }
    const messages = body.messages || [];
    const rows = messages.map(m => ({
      store_id: m.storeId || '',
      user_id: m.userId || '',
      direction: m.direction || 'received',
      message_type: m.messageType || 'text',
      message_text: m.messageText || '',
      message_id: m.messageId || '',
      timestamp: m.timestamp || new Date().toISOString()
    }));
    if (body.replace) {
      let del = supabase.from('line_messages').delete();
      del = body.storeId ? del.eq('store_id', body.storeId) : del.neq('id', 0);
      await del;
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('line_messages').insert(rows);
      if (error) throw error;
    }
    return { success: true, count: rows.length };
  }

  // Webhook形式 (events配列): LINE Platform からのコールバックで認証不要
  // （Webhook は api/line/webhook.js が店舗シークレットで署名検証済みなので素通し）
  if (body.events) {
    const rows = (body.events || []).map(ev => ({
      store_id: body.storeId || '', user_id: ev.userId || '',
      direction: 'received',
      message_type: ev.type === 'message' ? (ev.messageType || 'text') : ev.type,
      message_text: ev.messageText || '', message_id: ev.messageId || '',
      timestamp: ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString()
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from('line_messages').insert(rows);
      if (error) throw error;
    }
    return { success: true, stored: rows.length };
  }

  // 送信メッセージ記録: スタッフモードでは store 権限必須
  if (body.userId && body.messageText) {
    if (!canAccessStore(staffCtx, body.storeId)) {
      return { error: 'この店舗のLINEメッセージを記録する権限がありません' };
    }
    const { error } = await supabase.from('line_messages').insert({
      store_id: body.storeId || '', user_id: body.userId,
      direction: 'sent', message_type: 'text',
      message_text: body.messageText, message_id: ''
    });
    if (error) throw error;
    return { success: true };
  }

  return { error: 'events配列またはuserId+messageTextが必要です' };
}

function mapMsg(r) {
  return {
    timestamp: r.timestamp, storeId: r.store_id, userId: r.user_id,
    direction: r.direction, messageType: r.message_type,
    messageText: r.message_text || '', messageId: r.message_id || ''
  };
}

// ============================================================
// LINEプロフィール
// ============================================================

export async function lineProfilesGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) {
    // 店舗未指定は空レスポンス。店舗横断での顧客情報漏えいを防ぐ。
    return { profiles: [] };
  }
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗のプロフィールにアクセスする権限がありません' };
  }
  const { data, error } = await supabase.from('line_profiles').select('*')
    .eq('store_id', storeId);
  if (error) throw error;
  return {
    profiles: (data || []).map(r => ({
      userId: r.user_id, storeId: r.store_id,
      displayName: r.display_name || '', pictureUrl: r.picture_url || '',
      updatedAt: r.updated_at
    }))
  };
}

// LINE Messaging API のチャネルアクセストークンを取得
function getLineAccessToken(storeId) {
  if (!storeId) return null;
  const prefix = `LINE_STORE_${storeId}`;
  return process.env[`${prefix}_CHANNEL_ACCESS_TOKEN`] || process.env[`${prefix}_ACCESS_TOKEN`] || null;
}

// LINE Messaging API からプロフィールを取得し Supabase に upsert する
async function refreshLineProfile(storeId, userId, token) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      // 404 はブロック or 削除済み。名前は空のまま保持し、以降のAPI呼び出しを避ける。
      await supabase.from('line_profiles').upsert({
        user_id: userId, store_id: String(storeId),
        display_name: '', picture_url: '',
      }, { onConflict: 'user_id,store_id' });
      return { userId, ok: false, status: res.status };
    }
    const profile = await res.json();
    const displayName = profile.displayName || '';
    const pictureUrl = profile.pictureUrl || '';
    await supabase.from('line_profiles').upsert({
      user_id: userId, store_id: String(storeId),
      display_name: displayName, picture_url: pictureUrl,
    }, { onConflict: 'user_id,store_id' });
    return { userId, ok: true, displayName, pictureUrl };
  } catch (err) {
    return { userId, ok: false, error: err.message };
  }
}

// 並列で最大 concurrency 件ずつ処理する
async function processInBatches(items, concurrency, worker) {
  const out = [];
  let idx = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function lineProfilesPost(body, staffCtx) {
  const action = body.action || '';

  // 管理機能: スレッド一覧の表示名が空のユーザーを LINE Messaging API で一括補完する
  if (action === 'refresh' || action === 'backfill') {
    const storeId = body.storeId ? String(body.storeId) : '';
    if (!storeId) return { error: 'storeIdが必要です' };
    if (!canAccessStore(staffCtx, storeId)) {
      return { error: 'この店舗のプロフィールを更新する権限がありません' };
    }
    const token = getLineAccessToken(storeId);
    if (!token) return { error: `Store "${storeId}" に LINE アクセストークンが設定されていません` };

    // userIds が明示されている場合はそれだけ、なければ display_name が空の行を Supabase から抽出する
    let targetUserIds = Array.isArray(body.userIds) ? body.userIds.filter(Boolean) : [];
    if (targetUserIds.length === 0) {
      const { data, error } = await supabase.from('line_profiles')
        .select('user_id')
        .eq('store_id', storeId)
        .or('display_name.is.null,display_name.eq.');
      if (error) throw error;
      // ここで Set を介して初期化することで line_profiles 自体に重複行があっても除去される
      const seen = new Set();
      for (const row of (data || [])) {
        if (row.user_id && !seen.has(row.user_id)) {
          seen.add(row.user_id);
        }
      }
      // line_messages 側には存在するが line_profiles に未登録のユーザーも対象に加える
      const { data: msgRows, error: msgErr } = await supabase.from('line_messages')
        .select('user_id')
        .eq('store_id', storeId);
      if (!msgErr && msgRows) {
        for (const row of msgRows) {
          if (row.user_id) seen.add(row.user_id);
        }
      }
      targetUserIds = Array.from(seen);
    } else {
      // 呼び出し側からの userIds も念のため重複除去する
      targetUserIds = Array.from(new Set(targetUserIds));
    }

    if (targetUserIds.length === 0) return { success: true, refreshed: 0, results: [] };

    const results = await processInBatches(targetUserIds, 5, uid => refreshLineProfile(storeId, uid, token));
    const refreshed = results.filter(r => r && r.ok).length;
    return { success: true, refreshed, total: results.length, results };
  }

  if (!body.userId) return { error: 'userIdが必要です' };
  const { error } = await supabase.from('line_profiles').upsert({
    user_id: body.userId, store_id: body.storeId || '',
    display_name: body.displayName || '', picture_url: body.pictureUrl || ''
  }, { onConflict: 'user_id,store_id' });
  if (error) throw error;
  return { success: true };
}

// ============================================================
// LINE一斉配信
// ============================================================

export async function lineBroadcastsGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) return { broadcasts: [] };
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗の配信履歴にアクセスする権限がありません' };
  }
  const { data, error } = await supabase.from('line_broadcasts').select('*')
    .eq('store_id', storeId)
    .order('timestamp', { ascending: false })
    .limit(50);
  if (error) throw error;
  return {
    broadcasts: (data || []).map(r => ({
      timestamp: r.timestamp, storeId: r.store_id,
      broadcastType: r.broadcast_type || '', messageContent: r.message_content || '',
      recipientCount: r.recipient_count || 0, status: r.status || ''
    }))
  };
}

export async function lineBroadcastsPost(body, staffCtx) {
  if (body.action === 'saveAll') {
    if (staffCtx !== null) return { error: '一括保存は管理者のみ許可されています' };
    const broadcasts = body.broadcasts || [];
    const rows = broadcasts.map(b => ({
      store_id: b.storeId || '',
      broadcast_type: b.broadcastType || '',
      message_content: b.messageContent || '',
      recipient_count: b.recipientCount || 0,
      status: b.status || '',
      timestamp: b.timestamp || new Date().toISOString()
    }));
    if (body.replace) {
      let del = supabase.from('line_broadcasts').delete();
      del = body.storeId ? del.eq('store_id', body.storeId) : del.neq('id', 0);
      await del;
    }
    if (rows.length > 0) {
      const { error } = await supabase.from('line_broadcasts').insert(rows);
      if (error) throw error;
    }
    return { success: true, count: rows.length };
  }

  if (!canAccessStore(staffCtx, body.storeId)) {
    return { error: 'この店舗の配信履歴を記録する権限がありません' };
  }

  const { error } = await supabase.from('line_broadcasts').insert({
    store_id: body.storeId || '',
    broadcast_type: body.broadcastType || 'broadcast',
    message_content: body.messageContent || '',
    recipient_count: body.recipientCount || 0,
    status: body.status || 'sent',
    timestamp: body.timestamp || new Date().toISOString()
  });
  if (error) throw error;
  return { success: true };
}

// ============================================================
// LINEテンプレート
// ============================================================

export async function lineTemplatesGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) return { templates: [] };
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗のテンプレートにアクセスする権限がありません' };
  }
  const { data, error } = await supabase.from('line_templates').select('*')
    .eq('store_id', storeId)
    .order('created_at');
  if (error) throw error;
  return {
    templates: (data || []).map(r => ({
      templateId: r.template_id, storeId: r.store_id,
      name: r.name || '', category: r.category || '',
      messageType: r.message_type || '', messageContent: r.message_content || '',
      createdAt: r.created_at, updatedAt: r.updated_at
    }))
  };
}

export async function lineTemplatesPost(body, staffCtx) {
  const action = body.action || 'create';
  switch (action) {
    case 'saveAll': {
      if (staffCtx !== null) return { error: '一括保存は管理者のみ許可されています' };
      const templates = body.templates || [];
      const rows = templates.map(t => ({
        template_id: t.templateId || ('tmpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
        store_id: t.storeId || '',
        name: t.name || '',
        category: t.category || '',
        message_type: t.messageType || 'text',
        message_content: t.messageContent || '',
        created_at: t.createdAt || new Date().toISOString()
      }));
      if (body.replace) {
        let del = supabase.from('line_templates').delete();
        del = body.storeId ? del.eq('store_id', body.storeId) : del.neq('template_id', '');
        await del;
      }
      if (rows.length > 0) {
        const { error } = await supabase.from('line_templates').upsert(rows, { onConflict: 'template_id' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    case 'create': {
      if (!canAccessStore(staffCtx, body.storeId)) {
        return { error: 'この店舗にテンプレートを作成する権限がありません' };
      }
      const templateId = 'tmpl_' + Date.now();
      const { error } = await supabase.from('line_templates').insert({
        template_id: templateId, store_id: body.storeId || '',
        name: body.name || '', category: body.category || '',
        message_type: body.messageType || 'text',
        message_content: body.messageContent || ''
      });
      if (error) throw error;
      return { success: true, templateId, action: 'created' };
    }
    case 'update': {
      if (!body.templateId) return { error: 'templateIdが必要です' };
      if (staffCtx !== null) {
        // 既存レコードの店舗を確認してから編集許可を判定
        const { data: existing } = await supabase.from('line_templates')
          .select('store_id').eq('template_id', body.templateId).single();
        if (!existing) return { error: 'テンプレートが見つかりません' };
        if (!canAccessStore(staffCtx, existing.store_id)) {
          return { error: 'この店舗のテンプレートを編集する権限がありません' };
        }
      }
      const updates = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.category !== undefined) updates.category = body.category;
      if (body.messageType !== undefined) updates.message_type = body.messageType;
      if (body.messageContent !== undefined) updates.message_content = body.messageContent;
      const { error } = await supabase.from('line_templates').update(updates).eq('template_id', body.templateId);
      if (error) throw error;
      return { success: true, action: 'updated' };
    }
    case 'delete': {
      if (!body.templateId) return { error: 'templateIdが必要です' };
      if (staffCtx !== null) {
        const { data: existing } = await supabase.from('line_templates')
          .select('store_id').eq('template_id', body.templateId).single();
        if (!existing) return { error: 'テンプレートが見つかりません' };
        if (!canAccessStore(staffCtx, existing.store_id)) {
          return { error: 'この店舗のテンプレートを削除する権限がありません' };
        }
      }
      const { error } = await supabase.from('line_templates').delete().eq('template_id', body.templateId);
      if (error) throw error;
      return { success: true, action: 'deleted' };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

// ============================================================
// LINE自動応答
// ============================================================

export async function lineAutoRepliesGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) return { rules: [] };
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗の自動応答にアクセスする権限がありません' };
  }
  const { data, error } = await supabase.from('line_auto_replies').select('*')
    .eq('store_id', storeId)
    .order('priority', { ascending: false });
  if (error) throw error;
  return {
    rules: (data || []).map(r => ({
      ruleId: r.rule_id, storeId: r.store_id,
      keyword: r.keyword, matchMethod: r.match_method,
      replyType: r.reply_type, replyContent: r.reply_content || '',
      priority: r.priority, enabled: r.enabled, createdAt: r.created_at
    }))
  };
}

export async function lineAutoRepliesPost(body, staffCtx) {
  const action = body.action || 'create';
  // 既存レコードからの店舗取得ヘルパー（update/delete 用）
  const resolveRuleStore = async (ruleId) => {
    const { data } = await supabase.from('line_auto_replies').select('store_id').eq('rule_id', ruleId).single();
    return data ? data.store_id : null;
  };
  switch (action) {
    case 'saveAll': {
      if (staffCtx !== null) return { error: '一括保存は管理者のみ許可されています' };
      const rules = body.rules || [];
      const rows = rules.map(r => ({
        rule_id: r.ruleId || ('rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
        store_id: r.storeId || '',
        keyword: r.keyword || '',
        match_method: r.matchMethod || 'contains',
        reply_type: r.replyType || 'text',
        reply_content: r.replyContent || '',
        priority: r.priority || 0,
        enabled: r.enabled !== false,
        created_at: r.createdAt || new Date().toISOString()
      }));
      if (body.replace) {
        let del = supabase.from('line_auto_replies').delete();
        del = body.storeId ? del.eq('store_id', body.storeId) : del.neq('rule_id', '');
        await del;
      }
      if (rows.length > 0) {
        const { error } = await supabase.from('line_auto_replies').upsert(rows, { onConflict: 'rule_id' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    case 'create': {
      if (!canAccessStore(staffCtx, body.storeId)) {
        return { error: 'この店舗に自動応答ルールを作成する権限がありません' };
      }
      const ruleId = 'rule_' + Date.now();
      const { error } = await supabase.from('line_auto_replies').insert({
        rule_id: ruleId, store_id: body.storeId || '',
        keyword: body.keyword || '', match_method: body.matchMethod || 'contains',
        reply_type: body.replyType || 'text', reply_content: body.replyContent || '',
        priority: body.priority || 0, enabled: body.enabled !== false
      });
      if (error) throw error;
      return { success: true, ruleId, action: 'created' };
    }
    case 'update': {
      if (!body.ruleId) return { error: 'ruleIdが必要です' };
      if (staffCtx !== null) {
        const storeId = await resolveRuleStore(body.ruleId);
        if (!storeId) return { error: 'ルールが見つかりません' };
        if (!canAccessStore(staffCtx, storeId)) {
          return { error: 'この店舗の自動応答ルールを編集する権限がありません' };
        }
      }
      const updates = {};
      if (body.keyword !== undefined) updates.keyword = body.keyword;
      if (body.matchMethod !== undefined) updates.match_method = body.matchMethod;
      if (body.replyType !== undefined) updates.reply_type = body.replyType;
      if (body.replyContent !== undefined) updates.reply_content = body.replyContent;
      if (body.priority !== undefined) updates.priority = body.priority;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      const { error } = await supabase.from('line_auto_replies').update(updates).eq('rule_id', body.ruleId);
      if (error) throw error;
      return { success: true, action: 'updated' };
    }
    case 'delete': {
      if (!body.ruleId) return { error: 'ruleIdが必要です' };
      if (staffCtx !== null) {
        const storeId = await resolveRuleStore(body.ruleId);
        if (!storeId) return { error: 'ルールが見つかりません' };
        if (!canAccessStore(staffCtx, storeId)) {
          return { error: 'この店舗の自動応答ルールを削除する権限がありません' };
        }
      }
      const { error } = await supabase.from('line_auto_replies').delete().eq('rule_id', body.ruleId);
      if (error) throw error;
      return { success: true, action: 'deleted' };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

// ============================================================
// LINEタグ + ユーザータグ
// ============================================================

export async function lineTagsGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) return { tags: [] };
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗のタグにアクセスする権限がありません' };
  }
  const { data, error } = await supabase.from('line_tags').select('*')
    .eq('store_id', storeId)
    .order('created_at');
  if (error) throw error;
  return {
    tags: (data || []).map(r => ({
      tagId: r.tag_id, storeId: r.store_id,
      name: r.name, color: r.color, createdAt: r.created_at
    }))
  };
}

export async function lineTagsPost(body, staffCtx) {
  const action = body.action || 'create';
  const resolveTagStore = async (tagId) => {
    const { data } = await supabase.from('line_tags').select('store_id').eq('tag_id', tagId).single();
    return data ? data.store_id : null;
  };
  switch (action) {
    case 'saveAll': {
      if (staffCtx !== null) return { error: '一括保存は管理者のみ許可されています' };
      const tags = body.tags || [];
      const rows = tags.map(t => ({
        tag_id: t.tagId || ('tag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
        store_id: t.storeId || '',
        name: t.name || '',
        color: t.color || '#06C755',
        created_at: t.createdAt || new Date().toISOString()
      }));
      if (body.replace) {
        let del = supabase.from('line_tags').delete();
        del = body.storeId ? del.eq('store_id', body.storeId) : del.neq('tag_id', '');
        await del;
      }
      if (rows.length > 0) {
        const { error } = await supabase.from('line_tags').upsert(rows, { onConflict: 'tag_id' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    case 'create': {
      if (!canAccessStore(staffCtx, body.storeId)) {
        return { error: 'この店舗にタグを作成する権限がありません' };
      }
      const tagId = 'tag_' + Date.now();
      const { error } = await supabase.from('line_tags').insert({
        tag_id: tagId, store_id: body.storeId || '',
        name: body.name || '', color: body.color || '#06C755'
      });
      if (error) throw error;
      return { success: true, tagId, action: 'created' };
    }
    case 'update': {
      if (!body.tagId) return { error: 'tagIdが必要です' };
      if (staffCtx !== null) {
        const sid = await resolveTagStore(body.tagId);
        if (!sid) return { error: 'タグが見つかりません' };
        if (!canAccessStore(staffCtx, sid)) return { error: 'このタグを編集する権限がありません' };
      }
      const updates = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.color !== undefined) updates.color = body.color;
      const { error } = await supabase.from('line_tags').update(updates).eq('tag_id', body.tagId);
      if (error) throw error;
      return { success: true, action: 'updated' };
    }
    case 'delete': {
      if (!body.tagId) return { error: 'tagIdが必要です' };
      if (staffCtx !== null) {
        const sid = await resolveTagStore(body.tagId);
        if (!sid) return { error: 'タグが見つかりません' };
        if (!canAccessStore(staffCtx, sid)) return { error: 'このタグを削除する権限がありません' };
      }
      const { error } = await supabase.from('line_tags').delete().eq('tag_id', body.tagId);
      if (error) throw error;
      return { success: true, action: 'deleted' };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

export async function lineUserTagsGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) return { userTags: [] };
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗のユーザータグにアクセスする権限がありません' };
  }
  let query = supabase.from('line_user_tags').select('*').eq('store_id', storeId);
  if (params.userId) query = query.eq('user_id', params.userId);
  const { data, error } = await query;
  if (error) throw error;
  return {
    userTags: (data || []).map(r => ({
      storeId: r.store_id, userId: r.user_id,
      tagId: r.tag_id, assignedAt: r.assigned_at
    }))
  };
}

// ============================================================
// LINE分析 (lineAnalytics) - 計算専用・読み取り
// ============================================================

export async function lineAnalyticsGet(params, staffCtx) {
  const storeId = params.store ? String(params.store) : '';
  if (!storeId) return { analytics: null };
  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗のLINE分析にアクセスする権限がありません' };
  }
  const { data, error } = await supabase.from('line_messages')
    .select('timestamp, store_id, user_id, direction, message_type')
    .eq('store_id', storeId);
  if (error) throw error;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let totalReceived = 0, totalSent = 0;
  let last30Received = 0, last30Sent = 0;
  let last7Received = 0, last7Sent = 0;
  let follows = 0, unfollows = 0;
  const uniqueUsers = {};
  const dailyStats = {};
  const hourlyStats = {};

  for (const row of data || []) {
    const ts = new Date(row.timestamp);
    const direction = row.direction;
    const msgType = row.message_type;
    const userId = row.user_id;

    if (msgType === 'follow') { follows++; continue; }
    if (msgType === 'unfollow') { unfollows++; continue; }

    if (direction === 'received') {
      totalReceived++;
      uniqueUsers[userId] = true;
      if (ts >= thirtyDaysAgo) last30Received++;
      if (ts >= sevenDaysAgo) last7Received++;
    } else {
      totalSent++;
      if (ts >= thirtyDaysAgo) last30Sent++;
      if (ts >= sevenDaysAgo) last7Sent++;
    }

    if (ts >= thirtyDaysAgo) {
      const dateKey = ts.toISOString().slice(0, 10);
      if (!dailyStats[dateKey]) dailyStats[dateKey] = { received: 0, sent: 0 };
      if (direction === 'received') dailyStats[dateKey].received++;
      else dailyStats[dateKey].sent++;
    }

    const hour = ts.getHours();
    if (!hourlyStats[hour]) hourlyStats[hour] = { received: 0, sent: 0 };
    if (direction === 'received') hourlyStats[hour].received++;
    else hourlyStats[hour].sent++;
  }

  const dailyArray = Object.keys(dailyStats).sort().map(date => ({
    date, received: dailyStats[date].received, sent: dailyStats[date].sent
  }));

  const hourlyArray = [];
  for (let h = 0; h < 24; h++) {
    hourlyArray.push({
      hour: h,
      received: (hourlyStats[h] || { received: 0 }).received,
      sent: (hourlyStats[h] || { sent: 0 }).sent
    });
  }

  return {
    analytics: {
      total: { received: totalReceived, sent: totalSent },
      last30Days: { received: last30Received, sent: last30Sent },
      last7Days: { received: last7Received, sent: last7Sent },
      follows, unfollows,
      uniqueUsers: Object.keys(uniqueUsers).length,
      dailyStats: dailyArray,
      hourlyStats: hourlyArray
    }
  };
}

export async function lineUserTagsPost(body, staffCtx) {
  const action = body.action || 'add';
  switch (action) {
    case 'saveAll': {
      if (staffCtx !== null) return { error: '一括保存は管理者のみ許可されています' };
      const userTags = body.userTags || [];
      const rows = userTags.map(ut => ({
        store_id: ut.storeId || '',
        user_id: ut.userId || '',
        tag_id: ut.tagId || '',
        assigned_at: ut.assignedAt || new Date().toISOString()
      }));
      if (body.replace) {
        let del = supabase.from('line_user_tags').delete();
        del = body.storeId ? del.eq('store_id', body.storeId) : del.neq('tag_id', '');
        await del;
      }
      if (rows.length > 0) {
        const { error } = await supabase.from('line_user_tags').upsert(rows, { onConflict: 'store_id,user_id,tag_id' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    case 'add': {
      if (!canAccessStore(staffCtx, body.storeId)) {
        return { error: 'この店舗のユーザータグを編集する権限がありません' };
      }
      const { error } = await supabase.from('line_user_tags').upsert({
        store_id: body.storeId || '', user_id: body.userId || '',
        tag_id: body.tagId || ''
      }, { onConflict: 'store_id,user_id,tag_id' });
      if (error) throw error;
      return { success: true, action: 'added' };
    }
    case 'remove': {
      if (!canAccessStore(staffCtx, body.storeId)) {
        return { error: 'この店舗のユーザータグを編集する権限がありません' };
      }
      const { error } = await supabase.from('line_user_tags').delete()
        .eq('store_id', body.storeId).eq('user_id', body.userId).eq('tag_id', body.tagId);
      if (error) throw error;
      return { success: true, action: 'removed' };
    }
    default: return { error: '不明なaction: ' + action };
  }
}
