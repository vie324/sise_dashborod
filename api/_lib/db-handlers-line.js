import { supabase } from './supabase.js';

// ============================================================
// LINEメッセージ
// ============================================================

export async function lineMessagesGet(params) {
  if (params.userId && params.store) {
    // 個別ユーザーのタイムライン
    let query = supabase.from('line_messages').select('*')
      .eq('store_id', params.store).eq('user_id', params.userId)
      .order('timestamp', { ascending: false }).limit(parseInt(params.limit) || 100);
    const { data, error } = await query;
    if (error) throw error;
    return {
      messages: (data || []).map(mapMsg)
    };
  }

  // スレッド一覧 (store別の最新メッセージ)
  let query = supabase.from('line_messages').select('*')
    .order('timestamp', { ascending: false });
  if (params.store) query = query.eq('store_id', params.store);
  query = query.limit(500);

  const { data, error } = await query;
  if (error) throw error;

  // ユーザーごとに最新メッセージを集約
  const threadMap = {};
  for (const msg of data || []) {
    const key = `${msg.store_id}_${msg.user_id}`;
    if (!threadMap[key]) {
      threadMap[key] = { storeId: msg.store_id, userId: msg.user_id, lastMessage: mapMsg(msg), unread: 0 };
    }
    if (msg.direction === 'received') threadMap[key].unread++;
  }

  return { threads: Object.values(threadMap) };
}

export async function lineMessagesPost(body) {
  // Webhook形式 (events配列)
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

  // 送信メッセージ記録
  if (body.userId && body.messageText) {
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

export async function lineProfilesGet(params) {
  let query = supabase.from('line_profiles').select('*');
  if (params.store) query = query.eq('store_id', params.store);
  const { data, error } = await query;
  if (error) throw error;
  return {
    profiles: (data || []).map(r => ({
      userId: r.user_id, storeId: r.store_id,
      displayName: r.display_name || '', pictureUrl: r.picture_url || '',
      updatedAt: r.updated_at
    }))
  };
}

export async function lineProfilesPost(body) {
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

export async function lineBroadcastsGet(params) {
  let query = supabase.from('line_broadcasts').select('*')
    .order('timestamp', { ascending: false }).limit(50);
  if (params.store) query = query.eq('store_id', params.store);
  const { data, error } = await query;
  if (error) throw error;
  return {
    broadcasts: (data || []).map(r => ({
      timestamp: r.timestamp, storeId: r.store_id,
      broadcastType: r.broadcast_type || '', messageContent: r.message_content || '',
      recipientCount: r.recipient_count || 0, status: r.status || ''
    }))
  };
}

export async function lineBroadcastsPost(body) {
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

export async function lineTemplatesGet(params) {
  let query = supabase.from('line_templates').select('*').order('created_at');
  if (params.store) query = query.eq('store_id', params.store);
  const { data, error } = await query;
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

export async function lineTemplatesPost(body) {
  const action = body.action || 'create';
  switch (action) {
    case 'create': {
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

export async function lineAutoRepliesGet(params) {
  let query = supabase.from('line_auto_replies').select('*').order('priority', { ascending: false });
  if (params.store) query = query.eq('store_id', params.store);
  const { data, error } = await query;
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

export async function lineAutoRepliesPost(body) {
  const action = body.action || 'create';
  switch (action) {
    case 'create': {
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

export async function lineTagsGet(params) {
  let query = supabase.from('line_tags').select('*').order('created_at');
  if (params.store) query = query.eq('store_id', params.store);
  const { data, error } = await query;
  if (error) throw error;
  return {
    tags: (data || []).map(r => ({
      tagId: r.tag_id, storeId: r.store_id,
      name: r.name, color: r.color, createdAt: r.created_at
    }))
  };
}

export async function lineTagsPost(body) {
  const action = body.action || 'create';
  switch (action) {
    case 'create': {
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
      const updates = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.color !== undefined) updates.color = body.color;
      const { error } = await supabase.from('line_tags').update(updates).eq('tag_id', body.tagId);
      if (error) throw error;
      return { success: true, action: 'updated' };
    }
    case 'delete': {
      if (!body.tagId) return { error: 'tagIdが必要です' };
      const { error } = await supabase.from('line_tags').delete().eq('tag_id', body.tagId);
      if (error) throw error;
      return { success: true, action: 'deleted' };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

export async function lineUserTagsGet(params) {
  let query = supabase.from('line_user_tags').select('*');
  if (params.store) query = query.eq('store_id', params.store);
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

export async function lineUserTagsPost(body) {
  const action = body.action || 'add';
  switch (action) {
    case 'add': {
      const { error } = await supabase.from('line_user_tags').upsert({
        store_id: body.storeId || '', user_id: body.userId || '',
        tag_id: body.tagId || ''
      }, { onConflict: 'store_id,user_id,tag_id' });
      if (error) throw error;
      return { success: true, action: 'added' };
    }
    case 'remove': {
      const { error } = await supabase.from('line_user_tags').delete()
        .eq('store_id', body.storeId).eq('user_id', body.userId).eq('tag_id', body.tagId);
      if (error) throw error;
      return { success: true, action: 'removed' };
    }
    default: return { error: '不明なaction: ' + action };
  }
}
