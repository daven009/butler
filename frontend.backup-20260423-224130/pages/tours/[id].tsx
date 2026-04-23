import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getTourById } from '../../lib/repositories/toursRepository';
import type { Tour } from '../../lib/types';

function formatMoney(value?: number) {
  if (value === undefined) return 'Price TBD';

  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0
  }).format(value);
}

interface TourDetailPageProps {
  tour: Tour | null;
  id: string;
}

export default function TourDetailPage({ tour, id }: TourDetailPageProps) {
  if (!tour) {
    return (
      <main className="shell">
        <Link className="secondaryLink" href="/">Back to dashboard</Link>
        <section className="emptyState">
          <h1>Tour not found</h1>
          <p>This mock data set does not include a tour with id {id || '(missing)'}.</p>
        </section>
      </main>
    );
  }

  const openExceptions = tour.exceptions.filter((item) => !item.resolved);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Tour detail</p>
          <h1>{tour.buyerName}</h1>
          <p className="subtle">{tour.targetDate} · {tour.neighborhoods.join(', ')}</p>
        </div>
        <Link className="secondaryLink" href="/">Dashboard</Link>
      </header>

      <section className="detailGrid">
        <article className="panel">
          <h2>Tour basics</h2>
          <dl className="definitionGrid">
            <dt>Status</dt>
            <dd>{tour.status.replaceAll('_', ' ')}</dd>
            <dt>Buyer phone</dt>
            <dd>{tour.buyerPhone}</dd>
            <dt>Buyer agent</dt>
            <dd>{tour.agent.name}, {tour.agent.agencyName}</dd>
            <dt>Next action</dt>
            <dd>{tour.nextAction}</dd>
          </dl>
        </article>

        <article className="panel">
          <h2>Coordination overview</h2>
          <div className="miniStats">
            <span><strong>{tour.listings.length}</strong> listings</span>
            <span><strong>{tour.opposingAgentAvailability.length}</strong> agent replies</span>
            <span><strong>{openExceptions.length}</strong> open exceptions</span>
          </div>
        </article>
      </section>

      <section className="panel">
        <h2>Listings</h2>
        <div className="listingList">
          {tour.listings.map((listing) => (
            <article className="listingRow" key={listing.id}>
              <div>
                <h3>{listing.title}</h3>
                <p>{listing.address} · {listing.district}</p>
              </div>
              <div className="listingFacts">
                <span>{formatMoney(listing.askingPrice)}</span>
                <span>{listing.bedrooms ?? '-'} bd / {listing.bathrooms ?? '-'} ba</span>
                <span>{listing.status.replaceAll('_', ' ')}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="twoColumn">
        <article className="panel">
          <h2>Buyer availability</h2>
          <div className="slotList">
            {tour.buyerAvailability.map((slot) => (
              <div className="slot" key={slot.id}>
                <strong>{slot.date}</strong>
                <span>{slot.startTime} - {slot.endTime}</span>
                <span>{slot.preference.replaceAll('_', ' ')}</span>
                {slot.note && <p>{slot.note}</p>}
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h2>Recommended itinerary</h2>
          {tour.schedule.length > 0 ? (
            <div className="slotList">
              {tour.schedule.map((item) => {
                const listing = tour.listings.find((candidate) => candidate.id === item.listingId);
                return (
                  <div className="slot" key={item.id}>
                    <strong>{listing?.title || item.listingId}</strong>
                    <span>{item.startAt.slice(11, 16)} - {item.endAt.slice(11, 16)}</span>
                    <span>{item.travelBufferMinutes} min travel buffer</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="placeholder">Itinerary recommendation will appear here after buyer and listing agent slots are collected.</p>
          )}
        </article>
      </section>

      <section className="panel">
        <h2>Exception cards</h2>
        <div className="exceptionGrid">
          {openExceptions.length > 0 ? openExceptions.map((exception) => (
            <article className={`exception severity-${exception.severity.toLowerCase()}`} key={exception.id}>
              <span>{exception.severity}</span>
              <h3>{exception.title}</h3>
              <p>{exception.detail}</p>
              <small>Owner: {exception.owner.replaceAll('_', ' ')}</small>
            </article>
          )) : (
            <p className="placeholder">No open exceptions.</p>
          )}
        </div>
      </section>
    </main>
  );
}

export const getServerSideProps: GetServerSideProps<TourDetailPageProps> = async ({ params }) => {
  const id = typeof params?.id === 'string' ? params.id : '';
  return {
    props: {
      id,
      tour: getTourById(id) || null
    }
  };
};
