var base_url = 'https://theportal.wiki'
var player = document.getElementById('player');
var video_player = new Plyr('#video-player', {controls: []});
var active_player = player;
var track = document.getElementById('transcript');
var progress_bar = document.getElementById('progress-bar');
var url = new URL(window.location.href);
var episode_title = url.searchParams.get('ep');
var force_audio = url.searchParams.get('force_audio');
var force_video = url.searchParams.get('force_video');
var wiki_html = '';
var resources = [];
var cur_volume = 1;
var progress_hover = false;
var transcript_paragraph_deadair = 0.2;
var prev_active_cue, prev_active_resource, prev_active_note;
var scroll_counter = 0;
var scroll_track = true;
var voice_span_regex = /<v ([^>]+)>/g;

function format_seconds(s) {
    var t = new Date(s * 1000).toISOString().substr(11, 8);
    if (t.substr(0, 3) == '00:')
        t = t.substr(3);
    return t;
}

function timestamp_to_seconds(s) {
    var a = s.split(':');
    return (+a[0]) * 60 * 60 + (+a[1]) * 60 + (+a[2]); 
}

function parse_wiki_html() {
    var track_source = 'audio';
    var track_url = wiki_html.find('a[href$=".vtt"]');
    if (track_url.length) {
        track.onload = load_transcript;
        track.src = track_url.attr('href');
        player.textTracks[0].mode = 'hidden';
        if (track.src.toLowerCase().includes('video') || track.src.toLowerCase().includes('youtube'))
            track_source = 'youtube';
    }
    var youtube_a = wiki_html.find('a[href*="youtube.com"]');
    var youtube_url_valid = youtube_a.length && youtube_a.text().toLowerCase().includes('watch episode');
    if (!force_audio && (!track_url.length || track_source == 'youtube' || force_video) && youtube_url_valid) {
        var youtube_url = new URL(youtube_a.attr('href'));
        video_player.source = {
            type: 'video',
            sources: [{src: youtube_url.searchParams.get('v'), provider: 'youtube'}],
        };
        active_player = video_player;
        $('#right-pane').addClass('split');
        $('#video-pane').show();
        video_player.on('ready', add_event_listeners);
        $('#change-source-audio').show();
        $('#episode-list-open').addClass('can-change-source');
    } else {
        player.src = wiki_html.find('a[href$=".mp3"]').attr('href');
        add_event_listeners();
        if (youtube_url_valid) {
            $('#change-source-video').show();
            $('#episode-list-open').addClass('can-change-source');
        }
    }
    let origin = window.location.origin;
    Array.from(wiki_html[0].querySelectorAll('[href^="/"], [src^="/"]'))
        .map(x => x[x.src ? 'src' : 'href'] = x[x.src ? 'src' : 'href'].replace(origin, base_url));
    let parse_resources = (el, i) => {
        let id = 'resource-' + i;
        let resource_type = el.getAttribute('data-type');
        let is_resource = resource_type.indexOf('resource') !== -1;
        let is_note = resource_type.indexOf('note') !== -1;
        if (is_resource || is_note) {
            Array.from(el.querySelectorAll('[href]')).map(x => x.target = '_blank');
            let add_to = is_note ? '#notes-pane' : '#resources-pane';
            document.querySelector(add_to + ' .pane-content').appendChild(el);
        }
        let timestamp_attr = el.getAttribute('data-timestamp') || '';
        let timestamps = timestamp_attr.split(',').map(s => s.split('-').map(timestamp_to_seconds));
        resources.push({id: id, type: resource_type, timestamps: timestamps});
        if (timestamps.length) {
            el.id = id;
            el.style.order = timestamps[0];
        }
    }
    Array.from(wiki_html[0].querySelectorAll('div[data-type], div[data-timestamp]')).map(parse_resources);
}

function parse_episode_list(response) {
    var eplist_html = $(response.parse.text['*']);
    var ul = document.querySelector('#episode-list .pane-content ul');
    eplist_html.find('.episodes-table tr td:last-child a[href][title]').each(function() {
        var title = this.attributes.title.value;
        var url = window.location.pathname + '?ep=' + this.attributes.href.value.replace('/wiki/', '');
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = url;
        a.text = title;
        li.appendChild(a);
        ul.appendChild(li);
    });
}

function load_transcript() {
    var parahraphs = [];
    var parahraph = [];
    var prev_time = 0;
    var prev_speaker, cur_speaker;
    let non_vtt_speaker_regex = /^([A-Z].+ [A-Z].+:)/g;
    [... player.textTracks[0].cues].forEach(cue => {
        var voice_span_matches = new RegExp(voice_span_regex).exec(cue.text);
        if (voice_span_matches) {
            cur_speaker = voice_span_matches[1];
            let same_speaker = cur_speaker === prev_speaker;
            cue.text = cue.text.replace(voice_span_regex, same_speaker ? '' : '$1: ');
        } else {
            let non_vtt_speaker = new RegExp(non_vtt_speaker_regex).exec(cue.text);
            if (non_vtt_speaker) {
                cur_speaker = non_vtt_speaker[1];
            }
        }
        var first_letter = cue.text.substr(0, 1);
        var ends_in_punctuation = ['.', '?'].indexOf(cue.text.trim().substr(-1)) !== -1;
        let first_letter_is_capital = first_letter === first_letter.toUpperCase();
        let diff_speaker = prev_speaker && cur_speaker !== prev_speaker;
        if (prev_time && ((cue.startTime - prev_time >= transcript_paragraph_deadair && ends_in_punctuation != -1 && first_letter_is_capital) || diff_speaker)) {
            parahraphs.push(parahraph);
            parahraph = [];
        }
        parahraph.push(cue);
        prev_time = cue.endTime;
        if (cur_speaker) {
            prev_speaker = cur_speaker;
        }
    });
    if (parahraph.length) {
        parahraphs.push(parahraph);
    }
    var transcript_el = document.querySelector('#transcript-pane .pane-content');
    parahraphs.forEach(paragraph => {
        var p = document.createElement('p');
        paragraph.forEach(cue => {
            var span = document.createElement('span');
            span.textContent = cue.text + ' ';
            cue.transcript_span = span;
            p.appendChild(span);
        });
        transcript_el.appendChild(p);
    });
}

$('#play').on('click', function() {
    if (isNaN(active_player.duration))
        return;
    if (active_player.paused) {
        active_player.play();
        $('#play-pause').removeClass('play').addClass('pause');
    } else {
        active_player.pause();
        $('#play-pause').removeClass('pause').addClass('play');
    }
});

function player_can_play() {
    $('#player-time').text(format_seconds(active_player.currentTime) + ' / ' + format_seconds(active_player.duration));
}

function player_timeupdate() {
    if (isNaN(active_player.duration) || progress_hover)
        return;
    progress_bar.value = active_player.currentTime / active_player.duration;
    $('#player-time').text(format_seconds(active_player.currentTime) + ' / ' + format_seconds(active_player.duration));
    var active_resources = [];
    var last_active_note;
    resources.forEach(resource => {
        var el = document.getElementById(resource.id);
        var active_timestamps = resource.timestamps.map(range => {
            let [start, end] = range;
            if (start <= active_player.currentTime && (!end || end >= active_player.currentTime))
                return start;
            return false;
        }).filter(s => s).sort().reverse();
        if (active_timestamps.length) {
            active_resources.push(el);
            el.classList.add('active');
            el.last_timestamp = active_timestamps[0];
        }
    });
    active_resources.sort((a, b) => a.last_timestamp - b.last_timestamp);
    var last_active_resource = active_resources.filter(resource => $(resource).data('type') == 'resource').pop();
    var last_active_note = active_resources.filter(resource => $(resource).data('type') == 'note').pop();
    document.querySelectorAll('#resources-pane .active, #notes-pane .active').forEach(el => {
        if (el != last_active_resource && el != last_active_note)
            el.classList.remove('active')
    });
    if (last_active_resource && last_active_resource != prev_active_resource) {
        $('#resources-pane').animate({
            scrollTop: last_active_resource.offsetTop - (last_active_resource.offsetParent.offsetHeight / 2) + (last_active_resource.offsetHeight / 2)
        }, 300);
    }
    if (last_active_note && last_active_note != prev_active_note)
        $('#notes-pane').animate({
            scrollTop: last_active_note.offsetTop - (last_active_note.offsetParent.offsetHeight / 2) + (last_active_note.offsetHeight / 2)
        }, 300);
    prev_active_resource = last_active_resource;
    prev_active_note = last_active_note;
    if (player.textTracks[0].mode == 'hidden') {
        var active_spans = [];
        var last_active_cue;
        [... player.textTracks[0].cues].forEach(cue => {
            if (cue.startTime <= active_player.currentTime && cue.endTime >= active_player.currentTime) {
                cue.transcript_span.classList.add('active');
                active_spans.push(cue.transcript_span);
                last_active_cue = cue.transcript_span;
            }
        });
        document.querySelectorAll('#transcript-pane span.active').forEach(span => {
            if (active_spans.indexOf(span) == -1)
                span.classList.remove('active')
        });
        if (scroll_track && last_active_cue && last_active_cue != prev_active_cue) {
            $('#transcript-pane').animate({
                scrollTop: last_active_cue.offsetTop - (last_active_cue.offsetParent.offsetHeight / 2) + (last_active_cue.offsetHeight / 2)
            }, 300);
            scroll_counter = 0;
        }
        prev_active_cue = last_active_cue;
    }
}
function add_event_listeners() {
    var events_el = player;
    if (active_player != player)
        events_el = video_player.media;
    events_el.addEventListener('canplay', player_can_play);
    events_el.addEventListener('timeupdate', player_timeupdate);
}

$('#progress-bar').click(function(e) {
    if (isNaN(active_player.duration))
        return;
    var percent = e.offsetX / this.offsetWidth;
    active_player.currentTime = percent * active_player.duration;
    progress_bar.value = percent / 100;
}).mousemove(function(e) {
    if (isNaN(active_player.duration))
        return;
    progress_hover = true;
    var percent = e.offsetX / this.offsetWidth;
    $('#player-time').text(format_seconds(percent * active_player.duration) + ' / ' + format_seconds(active_player.duration));
    progress_bar.value = percent;
}).mouseout(function() {
    progress_hover = false;
    player_timeupdate();
});

$('.speed-btn').click(function(e) {
    e.preventDefault();
    var speed = parseFloat($('#speed').text());
    if ($(this).hasClass('up'))
        speed += 0.25;
    else
        speed -= 0.25;
    speed = Math.round( speed * 100 ) / 100;
    if (active_player == player)
        active_player.playbackRate = speed;
    else
        active_player.speed = speed;
    $('#speed').text(speed);
});

$('.volume-icon').click(function() {
    if ($(this).hasClass('on')) {
        active_player.volume = 0;
        $(this).removeClass('on').addClass('off');
        $('#volume-slider').slider('value', 0);
    } else {
        active_player.volume = cur_volume;
        $(this).removeClass('off').addClass('on');
        $('#volume-slider').slider('value', active_player.volume * 100);
    }
})

$('#volume-slider').slider({
    min: 0,
    max: 100,
    value: 100,
    range: 'min',
    slide: function(e, ui) {
        let v = ui.value / 100;
        active_player.volume = v;
        cur_volume = v;
    }
});

$('#transcript-pane').scroll(function(e) {
    if (e.originalEvent && !$(this).is(':animated')) {
        scroll_counter++;
        if (scroll_counter > 3) {
            scroll_track = false;
            $('#transcript-pane .focus').show();
        }
    }
});

$('#transcript-pane .focus').click(function() {
    scroll_track = true;
    $('#transcript-pane .focus').hide();
    prev_active_cue = null;
    player_timeupdate();
});

$('#episode-list-open').click(function() {
    $('#episode-list').toggle();
});

$('#episode-list .close').click(function() {
    $('#episode-list').hide();
});

$('#change-source-audio').click(function() {
    url.searchParams.delete('force_video');
    url.searchParams.set('force_audio', '1');
    window.location.href = url.href;
});

$('#change-source-video').click(function() {
    url.searchParams.delete('force_audio');
    url.searchParams.set('force_video', '1');
    window.location.href = url.href;
});

if (episode_title) {
    $.ajax({
        url: 'https://theportal.wiki/api.php',
        jsonp: 'callback',
        dataType: 'jsonp',
        data: {
            action: 'parse',
            page: episode_title,
            prop: 'text',
            format: 'json',
            utf8: '1',
        },
        success: function(response) {
            wiki_html = $(response['parse']['text']['*']);
            $('#episode-title').text(response['parse']['title']);
            parse_wiki_html();
        }
    });
} else {
    $('.welcome-text').show();
    $('#episode-title').text('Welcome to the portal player');
    $('#episode-list').show();
}

$.ajax({
    url: 'https://theportal.wiki/api.php',
    jsonp: 'callback',
    dataType: 'jsonp',
    data: {
        action: 'parse',
        page: 'All_Episodes',
        prop: 'text',
        format: 'json',
        utf8: '1',
    },
    success: function(response) {
        parse_episode_list(response);
    }
});
