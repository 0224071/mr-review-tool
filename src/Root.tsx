/**
 * 組裝根元件：依網址 ?demo=1 或使用者操作選擇正式／示範服務並注入 App。
 * 切換模式或重新開始示範時以新的 key 重新掛載 App，畫面狀態全部清空。
 */
import React, { useMemo, useState } from 'react';
import App from './App';
import { createLiveServices } from './app/live-services';
import { createDemoServices, DemoServicesOptions } from './demo/demo-services';
import { clearDemoFromUrl, isDemoSearch, markDemoInUrl } from './demo/demo-mode';

interface RootProps {
  /** 測試用：縮短示範的等待時間 */
  demoTiming?: Pick<DemoServicesOptions, 'analysisDelayMs' | 'publishDelayMs'>;
}

export default function Root({ demoTiming }: RootProps) {
  const [isDemo, setIsDemo] = useState(() => isDemoSearch(window.location.search));
  const [session, setSession] = useState(0);

  const services = useMemo(() => {
    const startDemo = () => {
      markDemoInUrl();
      setIsDemo(true);
      setSession((s) => s + 1);
    };
    const exitDemo = () => {
      clearDemoFromUrl();
      setIsDemo(false);
      setSession((s) => s + 1);
    };
    return isDemo
      ? createDemoServices({ onExit: exitDemo, onRestart: startDemo, ...demoTiming })
      : createLiveServices({ onTryDemo: startDemo });
    // session 變動時也重建，讓重新開始的示範拿到全新的假服務
  }, [isDemo, session, demoTiming]);

  return <App key={session} services={services} />;
}
