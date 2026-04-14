import { Component, Inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IonApp } from '@ionic/angular/standalone';
import { Storage } from '@ionic/storage-angular';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: 'app.component.html',
  imports: [IonApp, RouterOutlet],
})
export class AppComponent implements OnInit {
  constructor(@Inject(Storage) private storage: Storage) {}

  async ngOnInit(): Promise<void> {
    await this.storage.create();
    const theme = (await this.storage.get('settings.theme')) ?? 'sleek-dark';
    const fontSize = (await this.storage.get('settings.fontSize')) ?? 'medium';
    document.body.setAttribute('data-theme', theme);
    document.body.setAttribute('data-font-size', fontSize);
  }
}
