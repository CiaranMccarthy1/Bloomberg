import { Routes } from '@angular/router';
 
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./dashboard/dashboard.page').then(m => m.DashboardPage),
  },
  {
    path: 'market',
    loadComponent: () => import('./home/home.page').then(m => m.HomePage),
  },
  {
    path: 'about',
    loadComponent: () => import('./about/about.page').then(m => m.AboutPage),
  },
  { path: '**', redirectTo: '' },
];
 