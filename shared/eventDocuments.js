// An event can carry two separate PDFs, and a Challenge is the case that uses
// both: a Challenge PDF explaining the challenge, and a supply list of what to
// bring. They are distinct documents rather than two names for one, so each
// keeps its own three fields on the event record.
//
// Defined here because four places need to agree on them - the admin form, the
// viewer page, the feed API, and the GoDaddy embed (which cannot import this
// and instead receives the resolved URLs on its payload).
export const EVENT_DOCUMENT_KINDS = {
  'supply-list': {
    fallbackFileName: 'supply-list.pdf',
    fallbackTitle: 'Supply List',
    fileNameField: 'supplyListFileName',
    // Every non-listing type can carry one - see supportsSupplyList.
    challengeOnly: false,
    linkLabel: 'Supply List',
    routeSegment: 'supply-list',
    titleField: 'supplyListTitle',
    urlField: 'supplyListUrl'
  },
  'challenge-pdf': {
    fallbackFileName: 'challenge.pdf',
    fallbackTitle: 'Challenge PDF',
    fileNameField: 'documentFileName',
    // Only a Challenge offers this second upload; every other type has just
    // the supply list.
    challengeOnly: true,
    linkLabel: 'Challenge PDF',
    routeSegment: 'challenge-pdf',
    titleField: 'documentTitle',
    urlField: 'documentUrl'
  }
};

export function getEventDocumentKind(routeSegment) {
  return EVENT_DOCUMENT_KINDS[routeSegment] || EVENT_DOCUMENT_KINDS['supply-list'];
}

// Resolves a kind against an event, returning null when the event carries no
// such file - which is what every display site gates on.
export function getEventDocument(event, routeSegment) {
  const kind = getEventDocumentKind(routeSegment);
  const url = event?.[kind.urlField] || '';

  if (!url) {
    return null;
  }

  const title = event?.[kind.titleField] || kind.fallbackTitle;

  return {
    fileName: event?.[kind.fileNameField] || `${title}.pdf`,
    kind: kind.routeSegment,
    linkLabel: kind.linkLabel,
    title,
    url
  };
}

export function listEventDocuments(event) {
  return Object.keys(EVENT_DOCUMENT_KINDS)
    .map((routeSegment) => getEventDocument(event, routeSegment))
    .filter(Boolean);
}
