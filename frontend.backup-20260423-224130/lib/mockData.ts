import type { Tour, TourSummary } from './types';

export const tours: Tour[] = [
  {
    id: 'tour-1001',
    buyerName: 'Alicia Tan',
    buyerPhone: '+65 9123 4455',
    status: 'COORDINATING',
    targetDate: '2026-04-24',
    neighborhoods: ['River Valley', 'Orchard', 'Newton'],
    nextAction: 'Chase 2 listing agents for Friday afternoon slots',
    agent: {
      id: 'agent-001',
      name: 'Maya Chen',
      phone: '+65 8222 1010',
      email: 'maya.chen@example.com',
      agencyName: 'Northstar Realty'
    },
    listings: [
      {
        id: 'listing-101',
        title: 'Valley Park 3BR',
        address: '473 River Valley Road',
        district: 'D10',
        askingPrice: 2380000,
        bedrooms: 3,
        bathrooms: 2,
        status: 'WAITING_REPLY',
        opposingAgentName: 'Daniel Lim',
        opposingAgentPhone: '+65 9000 1111',
        notes: 'Seller prefers viewings after 2 PM.'
      },
      {
        id: 'listing-102',
        title: 'Scotts Square 2BR',
        address: '6 Scotts Road',
        district: 'D09',
        askingPrice: 3100000,
        bedrooms: 2,
        bathrooms: 2,
        status: 'AVAILABLE_SLOTS_RECEIVED',
        opposingAgentName: 'Priya Nair',
        opposingAgentPhone: '+65 9000 2222'
      },
      {
        id: 'listing-103',
        title: 'Newton Suites 3BR',
        address: '60 Newton Road',
        district: 'D11',
        askingPrice: 2650000,
        bedrooms: 3,
        bathrooms: 3,
        status: 'NEEDS_REVIEW',
        opposingAgentName: 'Ethan Wong',
        opposingAgentPhone: '+65 9000 3333',
        notes: 'Slot conflicts with buyer school pickup.'
      }
    ],
    buyerAvailability: [
      {
        id: 'buyer-slot-1',
        date: '2026-04-24',
        startTime: '13:00',
        endTime: '17:30',
        preference: 'PREFERRED',
        note: 'Buyer wants central locations first.'
      },
      {
        id: 'buyer-slot-2',
        date: '2026-04-25',
        startTime: '10:00',
        endTime: '12:30',
        preference: 'AVAILABLE'
      }
    ],
    opposingAgentAvailability: [
      {
        id: 'oa-slot-1',
        agentName: 'Priya Nair',
        listingId: 'listing-102',
        slots: [
          { date: '2026-04-24', startTime: '14:30', endTime: '15:00' },
          { date: '2026-04-24', startTime: '16:00', endTime: '16:30' }
        ],
        lastUpdatedAt: '2026-04-19T10:15:00.000Z',
        source: 'MANUAL'
      }
    ],
    coordinationEvents: [],
    schedule: [
      {
        id: 'schedule-1',
        listingId: 'listing-102',
        startAt: '2026-04-24T14:30:00+08:00',
        endAt: '2026-04-24T15:00:00+08:00',
        travelBufferMinutes: 20,
        status: 'PROPOSED'
      }
    ],
    exceptions: [
      {
        id: 'exception-1',
        tourId: 'tour-1001',
        listingId: 'listing-101',
        title: 'Waiting for availability',
        detail: 'Daniel has not confirmed whether Friday afternoon is possible.',
        severity: 'MEDIUM',
        owner: 'OPPOSING_AGENT',
        resolved: false
      },
      {
        id: 'exception-2',
        tourId: 'tour-1001',
        listingId: 'listing-103',
        title: 'Buyer timing conflict',
        detail: 'Available Newton slot overlaps with school pickup window.',
        severity: 'HIGH',
        owner: 'BUYER_AGENT',
        resolved: false
      }
    ],
    createdAt: '2026-04-18T03:20:00.000Z',
    updatedAt: '2026-04-19T11:00:00.000Z'
  },
  {
    id: 'tour-1002',
    buyerName: 'Marcus Lee',
    buyerPhone: '+65 9888 7301',
    status: 'READY_TO_SCHEDULE',
    targetDate: '2026-04-26',
    neighborhoods: ['Tanjong Pagar', 'Marina Bay'],
    nextAction: 'Review proposed order and send final confirmation',
    agent: {
      id: 'agent-001',
      name: 'Maya Chen',
      phone: '+65 8222 1010',
      email: 'maya.chen@example.com',
      agencyName: 'Northstar Realty'
    },
    listings: [
      {
        id: 'listing-201',
        title: 'Wallich Residence 1BR',
        address: '3 Wallich Street',
        district: 'D02',
        askingPrice: 1980000,
        bedrooms: 1,
        bathrooms: 1,
        status: 'SCHEDULED',
        opposingAgentName: 'Sarah Koh',
        opposingAgentPhone: '+65 9111 8888'
      },
      {
        id: 'listing-202',
        title: 'Marina One 2BR',
        address: '21 Marina Way',
        district: 'D01',
        askingPrice: 2850000,
        bedrooms: 2,
        bathrooms: 2,
        status: 'SCHEDULED',
        opposingAgentName: 'Aaron Goh',
        opposingAgentPhone: '+65 9222 9999'
      }
    ],
    buyerAvailability: [
      {
        id: 'buyer-slot-3',
        date: '2026-04-26',
        startTime: '09:30',
        endTime: '12:30',
        preference: 'PREFERRED'
      }
    ],
    opposingAgentAvailability: [
      {
        id: 'oa-slot-2',
        agentName: 'Sarah Koh',
        listingId: 'listing-201',
        slots: [{ date: '2026-04-26', startTime: '10:00', endTime: '10:30' }],
        lastUpdatedAt: '2026-04-19T08:45:00.000Z',
        source: 'CALL'
      },
      {
        id: 'oa-slot-3',
        agentName: 'Aaron Goh',
        listingId: 'listing-202',
        slots: [{ date: '2026-04-26', startTime: '11:15', endTime: '11:45' }],
        lastUpdatedAt: '2026-04-19T09:12:00.000Z',
        source: 'SMS'
      }
    ],
    coordinationEvents: [],
    schedule: [
      {
        id: 'schedule-2',
        listingId: 'listing-201',
        startAt: '2026-04-26T10:00:00+08:00',
        endAt: '2026-04-26T10:30:00+08:00',
        travelBufferMinutes: 25,
        status: 'PROPOSED'
      },
      {
        id: 'schedule-3',
        listingId: 'listing-202',
        startAt: '2026-04-26T11:15:00+08:00',
        endAt: '2026-04-26T11:45:00+08:00',
        travelBufferMinutes: 0,
        status: 'PROPOSED'
      }
    ],
    exceptions: [
      {
        id: 'exception-3',
        tourId: 'tour-1002',
        title: 'Confirmation message not sent',
        detail: 'Schedule is ready, but buyer and listing agents have not received final confirmations.',
        severity: 'LOW',
        owner: 'BUYER_AGENT',
        resolved: false
      }
    ],
    createdAt: '2026-04-17T05:10:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z'
  }
];

export function summarizeTour(tour: Tour): TourSummary {
  return {
    id: tour.id,
    buyerName: tour.buyerName,
    status: tour.status,
    targetDate: tour.targetDate,
    listingCount: tour.listings.length,
    openExceptionCount: tour.exceptions.filter((item) => !item.resolved).length,
    nextAction: tour.nextAction,
    neighborhoods: tour.neighborhoods
  };
}
