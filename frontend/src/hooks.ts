import { useCallback, useEffect, useState } from 'react';
import { api, apiError } from './api';

export function useFetch<T>(url: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<T>(url);
      setData(data);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  return { data, loading, error, reload, setData };
}
