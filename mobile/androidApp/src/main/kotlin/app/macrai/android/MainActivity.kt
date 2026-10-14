package app.macrai.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarViewWeek
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import app.macrai.android.ui.catalog.CatalogScreen
import app.macrai.android.ui.chat.ChatScreen
import app.macrai.android.ui.settings.SettingsScreen
import app.macrai.android.ui.theme.MacrAITheme
import app.macrai.android.ui.week.WeekScreen

private enum class Tab(val label: String, val icon: ImageVector) {
    Hoy("Hoy", Icons.Outlined.ChatBubbleOutline),
    Semana("Semana", Icons.Outlined.CalendarViewWeek),
    Catalogo("Catálogo", Icons.AutoMirrored.Outlined.MenuBook),
    Ajustes("Ajustes", Icons.Outlined.Settings),
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as MacrAIApplication
        setContent {
            MacrAITheme {
                var tab by rememberSaveable { mutableIntStateOf(0) }
                Scaffold(
                    containerColor = MaterialTheme.colorScheme.background,
                    bottomBar = {
                        NavigationBar(containerColor = MaterialTheme.colorScheme.background) {
                            Tab.entries.forEachIndexed { index, t ->
                                NavigationBarItem(
                                    selected = tab == index,
                                    onClick = { tab = index },
                                    icon = { Icon(t.icon, contentDescription = null) },
                                    label = { Text(t.label) },
                                    colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.primary),
                                )
                            }
                        }
                    },
                ) { padding ->
                    val modifier = Modifier.padding(padding)
                    when (Tab.entries[tab]) {
                        Tab.Hoy -> ChatScreen(app, modifier)
                        Tab.Semana -> WeekScreen(app, modifier)
                        Tab.Catalogo -> CatalogScreen(app, modifier)
                        Tab.Ajustes -> SettingsScreen(app, modifier)
                    }
                }
            }
        }
    }
}
