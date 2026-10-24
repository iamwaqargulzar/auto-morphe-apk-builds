package com.iamwaqargulzar.automurph

import android.app.Application
import com.iamwaqargulzar.automurph.work.UpdateWorker

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        UpdateWorker.createChannel(this)
        UpdateWorker.schedule(this)
    }
}
