import { describe, it, expect } from 'vitest';
import {
  META_REQUESTED_PERMISSIONS, META_REQUIRED_PERMISSIONS, grantedMetaPermissions, missingMetaPermissions,
} from './meta-permissions.js';

describe('Meta izin listesi ayristirma', () => {
  it('yalniz status=granted verilmis sayilir; declined ve expired sayilmaz', () => {
    const granted = grantedMetaPermissions({
      data: [
        { permission: 'ads_read', status: 'granted' },
        { permission: 'ads_management', status: 'declined' },
        { permission: 'pages_show_list', status: 'expired' },
        { permission: 'email', status: 'granted' },
      ],
      paging: {},
    });
    expect(granted && [...granted].sort()).toEqual(['ads_read', 'email']);
    expect(missingMetaPermissions(granted!)).toEqual(['ads_management', 'pages_show_list']);
  });

  it('bicim disi govde dogrulanamadi demektir (null) — bos liste ile karistirilmaz', () => {
    expect(grantedMetaPermissions(null)).toBeNull();
    expect(grantedMetaPermissions({})).toBeNull();
    expect(grantedMetaPermissions({ data: 'ads_read' })).toBeNull();
    expect(grantedMetaPermissions({ error: { code: 190 } })).toBeNull();
    // bos dizi gecerli cevap: hicbir izin verilmemis
    expect(missingMetaPermissions(grantedMetaPermissions({ data: [] })!)).toEqual([...META_REQUIRED_PERMISSIONS]);
  });

  it('bozuk satirlar yok sayilir', () => {
    const granted = grantedMetaPermissions({ data: [null, 5, { permission: 7, status: 'granted' }, { permission: 'ads_read', status: 'GRANTED' }, { permission: 'ads_read', status: 'granted' }] });
    expect(granted && [...granted]).toEqual(['ads_read']);
  });

  it('zorunlu izinlerin hepsi izin ekraninda isteniyor', () => {
    for (const p of META_REQUIRED_PERMISSIONS) expect(META_REQUESTED_PERMISSIONS).toContain(p);
  });
});
