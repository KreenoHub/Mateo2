// ui/status.js - Sync status indicator

export class SyncStatus {
    constructor() {
        this.element = document.getElementById('sync-status');
        this.textElement = this.element.querySelector('.status-text');
        this.currentStatus = 'offline';
        
        // Set initial status
        this.update(navigator.onLine ? 'online' : 'offline');
    }

    update(status) {
        this.currentStatus = status;
        
        // Remove all status classes
        this.element.className = 'sync-status';
        
        // Add appropriate class and text
        switch (status) {
            case 'offline':
                this.element.classList.add('offline');
                this.textElement.textContent = 'Offline';
                break;
            case 'online':
                this.element.classList.add('synced');
                this.textElement.textContent = 'Online';
                break;
            case 'syncing':
                this.element.classList.add('syncing');
                this.textElement.textContent = 'Syncing...';
                break;
            case 'synced':
                this.element.classList.add('synced');
                this.textElement.textContent = 'Up to date';
                // Show confirmation briefly
                setTimeout(() => {
                    if (this.currentStatus === 'synced') {
                        this.update('online');
                    }
                }, 3000);
                break;
            case 'error':
                this.element.classList.add('error');
                this.textElement.textContent = 'Sync error';
                break;
            default:
                this.element.classList.add('offline');
                this.textElement.textContent = 'Unknown';
        }
    }
}