export function getAvatarLabel(name = '') {
  const trimmed = String(name).trim();
  if (!trimmed) return 'C';
  const compact = trimmed.replace(/\s+/g, '');
  if (/[\u4e00-\u9fff]/.test(compact)) return compact.slice(0, 1);
  return trimmed.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function formatRelativeLabel(updatedAt) {
  if (!updatedAt) return 'recently';
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;
  return `${Math.round(diffMinutes / 1440)}d ago`;
}

export function mapTourStatus(status = '') {
  const normalized = String(status).toUpperCase();
  switch (normalized) {
    case 'COORDINATING':
      return 'coordinating';
    case 'CONFIRMED':
    case 'COMPLETED':
      return 'confirmed';
    case 'READY_TO_SCHEDULE':
      return 'searching';
    default:
      return 'planning';
  }
}

function getTourColor(index = 0) {
  return ['#FF385C', '#00A699', '#FC642D', '#914669'][index % 4];
}

export function adaptTourCard(tour, index = 0) {
  const confirmedCount = tour.schedule.length;
  const needsAttentionCount = tour.exceptions.filter((item) => !item.resolved).length;
  const pendingCount = Math.max(
    0,
    tour.listings.filter((item) => !['SCHEDULED', 'AVAILABLE_SLOTS_RECEIVED'].includes(item.status)).length
  );

  return {
    id: tour.id,
    buyer: tour.buyerName,
    avatar: getAvatarLabel(tour.buyerName),
    type: `${tour.listings[0]?.bedrooms || 0 || 'Multi'}BR tour`,
    status: mapTourStatus(tour.status),
    progress: confirmedCount + needsAttentionCount,
    total: Math.max(tour.listings.length, 1),
    updated: formatRelativeLabel(tour.updatedAt),
    color: getTourColor(index),
    preview: needsAttentionCount
      ? `${confirmedCount} confirmed · ${needsAttentionCount} needs you`
      : tour.nextAction || 'Tour ready for review',
    confirmedCount,
    pendingCount,
    needsAttentionCount,
  };
}

export function adaptClient(client) {
  return {
    ...client,
    avatar: client.avatar || getAvatarLabel(client.name),
    updatedLabel: formatRelativeLabel(client.updatedAt),
  };
}

export function adaptThread(thread) {
  return {
    id: thread.id,
    agent: thread.agentName,
    avatar: getAvatarLabel(thread.agentName),
    unit: thread.listingTitle,
    status: thread.status,
    color: '#E07A5F',
    time: thread.scheduledTime || 'Pending',
    last: thread.lastMessage,
    ownership: thread.ownership,
  };
}
