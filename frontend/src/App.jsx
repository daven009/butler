import { Navigate, Route, Routes } from 'react-router-dom';
import { ClientProvider } from './clientStore';
import { ButlerProvider } from './context/ButlerContext';
import PhoneFrame from './components/PhoneFrame';
import BuyerView from './screens/BuyerView';
import Chat from './screens/Chat';
import Client from './screens/Client';
import ClientDetail from './screens/ClientDetail';
import DecisionCard from './screens/DecisionCard';
import Home from './screens/Home';
import Itinerary from './screens/Itinerary';
import Notifications from './screens/Notifications';
import Onboarding from './screens/Onboarding';
import Schedule from './screens/Schedule';
import Search from './screens/Search';
import Settings from './screens/Settings';
import TourDetail from './screens/TourDetail';

export default function App() {
  return (
    <ButlerProvider>
      <ClientProvider>
        <div className="stage">
          <div className="stage-copy">
            <div className="stage-eyebrow">butler.ai · mobile tour planner</div>
            <h1 className="stage-title">A coordination room for property agents.</h1>
            <p className="stage-description">
              Every screen from the original concept now lives as a routed React page inside a single iOS frame.
            </p>
          </div>

          <PhoneFrame>
            <Routes>
              <Route path="/" element={<Onboarding />} />
              <Route path="/home" element={<Home />} />
              <Route path="/schedule" element={<Schedule />} />
              <Route path="/search" element={<Search />} />
              <Route path="/tour" element={<TourDetail />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/decision" element={<DecisionCard />} />
              <Route path="/itinerary" element={<Itinerary />} />
              <Route path="/buyer" element={<BuyerView />} />
              <Route path="/client" element={<Client />} />
              <Route path="/client/new" element={<ClientDetail isNewEntry />} />
              <Route path="/client/:clientId" element={<ClientDetail />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PhoneFrame>
        </div>
      </ClientProvider>
    </ButlerProvider>
  );
}
