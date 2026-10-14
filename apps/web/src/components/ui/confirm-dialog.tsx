'use client';

import * as React from 'react';
import { Button } from './button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';

/**
 * window.confirm() yerine — marka diliyle, klavyeyle erişilebilir, yıkıcı
 * eylemde kırmızı düğme. Kullanım:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Silinsin mi?', danger: true })) ...
 */
type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

const ConfirmContext = React.createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = React.useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onOpenChange={(o) => { if (!o) close(false); }}>
        <DialogContent size="sm" hideClose>
          <DialogHeader className="border-b-0 pb-0">
            <DialogTitle>{state?.title}</DialogTitle>
          </DialogHeader>
          {state?.description && (
            <DialogBody className="pt-2">
              <DialogDescription asChild><div>{state.description}</div></DialogDescription>
            </DialogBody>
          )}
          <DialogFooter className="border-t-0">
            <Button variant="outline" size="sm" onClick={() => close(false)}>{state?.cancelLabel ?? 'Vazgeç'}</Button>
            <Button size="sm" autoFocus variant={state?.danger ? 'destructive' : 'default'} onClick={() => close(true)}>
              {state?.confirmLabel ?? 'Onayla'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** Provider yoksa tarayıcı confirm'üne düşer (ör. izole testler) */
export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  return React.useCallback(
    (o: ConfirmOptions) => (ctx ? ctx(o) : Promise.resolve(window.confirm(o.title))),
    [ctx],
  );
}
