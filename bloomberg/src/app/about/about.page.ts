import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { Device } from '@capacitor/device';
import { Storage } from '@ionic/storage-angular';

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

  constructor(@Inject(Storage) private storage: Storage) {}

  async ngOnInit(): Promise<void> {
    await this.storage.create();
    const info = await Device.getInfo();
    this.platform = info.platform;
    this.operatingSystem = info.operatingSystem;
    this.model = info.model;
    this.appSymbol = (await this.storage.get('symbol')) ?? '^GSPC';
    this.appRange = (await this.storage.get('range')) ?? '5d';
  }
}
