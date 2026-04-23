import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Device } from '@capacitor/device';
import { FinanceService } from '../services/finance.service';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, RouterLink, IonContent],
  templateUrl: './about.page.html',
  styleUrls: ['./about.page.scss']
})
export class AboutPage implements OnInit {
  platform = 'loading';
  operatingSystem = 'loading';
  model = 'loading';
  appSymbol = '—';
  appRange = '—';

  constructor(private financeService: FinanceService) {}

  async ngOnInit(): Promise<void> {
    const info = await Device.getInfo();
    this.platform = info.platform;
    this.operatingSystem = info.operatingSystem;
    this.model = info.model;
    this.appSymbol = await this.financeService.getStorageValue('symbol', '^GSPC');
    this.appRange = await this.financeService.getStorageValue('range', '5d');
  }
}
