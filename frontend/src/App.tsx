import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Executive from './pages/dashboards/Executive';
import StockSummary from './pages/dashboards/StockSummary';
import FactoryLedger from './pages/dashboards/FactoryLedger';
import SalesDashboard from './pages/dashboards/SalesDashboard';
import DispatchTracking from './pages/dashboards/DispatchTracking';
import PaymentsDashboard from './pages/dashboards/PaymentsDashboard';
import BookingEntry from './pages/entry/BookingEntry';
import SaleEntry from './pages/entry/SaleEntry';
import SupplierPayment from './pages/entry/SupplierPayment';
import DealerPayment from './pages/entry/DealerPayment';
import Masters from './pages/masters/Masters';
import SalesPeople from './pages/masters/SalesPeople';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Executive />} />
        <Route path="stock" element={<StockSummary />} />
        <Route path="ledger" element={<FactoryLedger />} />
        <Route path="sales-dashboard" element={<SalesDashboard />} />
        <Route path="dispatch-tracking" element={<DispatchTracking />} />
        <Route path="payments-dashboard" element={<PaymentsDashboard />} />
        <Route path="bookings" element={<BookingEntry />} />
        <Route path="sales" element={<SaleEntry />} />
        <Route path="supplier-payments" element={<SupplierPayment />} />
        <Route path="dealer-payments" element={<DealerPayment />} />
        <Route path="masters/sales-people" element={<SalesPeople />} />
        <Route path="masters/:entity" element={<Masters />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
